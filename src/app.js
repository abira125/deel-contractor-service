const express = require('express'),
  bodyParser = require('body-parser'),
  {sequelize} = require('./model'),
  app = express(),
  fs = require('fs');

app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

const {getProfile} = require('./middleware/getProfile'),

  {validateContractId,
    validateStartAndEndDates,
    validateJobId,
    validateUserId,
    validateAmountToDeposit} = require('./middleware/validate'),

  {getActiveContractsForProfile,
    getNonTerminatedContractsForProfile,
    getUnpaidJobsForContracts,
    getJobAndContractByJobId,
    makePaymentForJob,
    groupPaymentsByContractor,
    groupPaymentsByProfession,
    groupPaymentsByClient,
    addClientDetailsToPayments} = require('./services/ContractService'),

  {serverError, unauthorizedError, notFound, badRequest, sendError} = require('./helper/Errors');

/**
 * A basic health check route
*/
app.get('/health', async (req, res) => {
  try {
    // Check if database file exists
    const dbFileExists = fs.existsSync('./database.sqlite3');
    if (!dbFileExists) {
      const error = serverError('Database file does not exist');
      return sendError(error, res);
    }
    // Check if the database can be reached
    await sequelize.query('SELECT 1');
    return res.status(200).json({status: 'ok'});
  } catch (error) {
    console.error(error);
    sendError(serverError(), res);
  }
});

/**
 * - Returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
app.get('/contracts/:id',[getProfile, validateContractId] ,async (req, res) =>{
  const {Contract} = req.app.get('models'),
    {id} = req.params,
    {id: profileId, type: profileType} = req.profile;

  try {
    const contract = await Contract.findOne({where: {id}});

    if(!contract) {
      const error = notFound('No contract found with the given id');
      return sendError(error, res);
    }

    const contractDoesNotBelongToContractor = profileType === 'contractor' && profileId !== contract.ContractorId,
      contractDoesNotBelongToClient = profileType === 'client' && profileId !== contract.ClientId,
      contractDoesNotBelongToProfile = contractDoesNotBelongToContractor || contractDoesNotBelongToClient;

    if (contractDoesNotBelongToProfile) {
      const error = unauthorizedError();
      return sendError(error, res);
    }

    return res.json(contract);
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }

});

/**
 * - Returns a list of contracts belonging to a user (client or contractor), the list should only contain non terminated contracts.
 */
app.get('/contracts/', getProfile, async (req, res) => {
  // Get all contracts for the given profile id
  try {
    const contracts = await getNonTerminatedContractsForProfile(req.profile);
    return res.json({ contracts});
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }
});

/**
 * Get all unpaid jobs for a user (**_either_** a client or contractor), for **_active contracts only_**.
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  try {
    // Get all active contracts
    const contracts = await getActiveContractsForProfile(req.profile),
      contractIds = contracts.map((contract) => {
        return contract.id;
      });

    if (contractIds.length === 0) {
      return res.json({unpaidJobs: []});
    }

    const unpaidJobs = await getUnpaidJobsForContracts(contractIds);
    return res.json({unpaidJobs});
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }
});

/**
 *Pay for a job, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance.
*/
app.post('/jobs/:job_id/pay', [getProfile, validateJobId], async (req, res) => {
  const {profile} = req,
    {job_id: jobId} = req.params;

  // ToDo: Introduce idempotence keys to prevent duplicate payments
  try {
    // Paying profile should be a client
    if (profile.type !== 'client') {
      return sendError(unauthorizedError(), res);
    }

    const job = await getJobAndContractByJobId(jobId);
    // Job should exist
    if (!job) {
      const error = notFound('No job found with the given id');
      return sendError(error, res);
    }

    const {Contract: contract, price: amountToPay} = job;

    // Contract should exist
    if (!contract) {
      const error = notFound('No contract found for the given job');
      return sendError(error, res);
    }

    // Job should belong to the client
    const clientId = contract.ClientId;
    if (profile.id !== clientId) {
      const error = unauthorizedError('You are not elligible to pay for this job');
      return sendError(error, res);
    }

    // Check for sufficient balance
    if (profile.balance < amountToPay) {
      const error = badRequest({detail: 'Insufficient balance'});
      return sendError(error, res);
    }

    // Contract should be in progress
    if (contract.status !== 'in_progress') {
      const error = badRequest({detail: 'Contract has been terminated. Payment can not be made for a terminated contract.'});
      return sendError(error, res);
    }

    // The job should be unpaid
    if (job.paid === true) {
      const error = badRequest({detail: 'This job has already been paid for!'});
      return sendError(error, res);
    }

    await makePaymentForJob(profile, contract, job, amountToPay);

    return res.status(200).json({message: 'Payment successful'});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});

/** Deposits money into the the the balance of a client, a client can't deposit more than 25% his total of jobs to pay. (at the deposit moment) */
app.post('/balances/deposit/:userId', [getProfile, validateUserId, validateAmountToDeposit], async (req, res) => {
  const {Profile} = req.app.get('models');
  const {userId} = req.params;
  const {amount_to_deposit: depositAmount} = req.body;
  const {profile} = req;

  // Check if the user is the same as the requesting profile
  if (profile.id !== Number(userId)) {
    return sendError(unauthorizedError(), res);
  }

  // Check if the user is a client
  if (profile.type !== 'client') {
    return sendError(unauthorizedError(), res);
  }

  // ToDo: Introduce idempotence keys to prevent duplicate deposits
  try {

    // Check if the amount is more than 25% of the total of jobs that are unpaid
    // 1. Get all active contracts
    const contracts = await getActiveContractsForProfile(profile, req);
    const contractIds = contracts.map((contract) => {
      return contract.id;
    });

    // 2. Get total price of all unpaid jobs for the given contracts
    const unpaidJobs = await getUnpaidJobsForContracts(contractIds);

    const totalUnpaid = unpaidJobs.reduce((acc, job) => {
      return acc + job.price;
    }, 0);

    // 3. If the amount is more than 25% of the total of jobs that are unpaid, return
    if (depositAmount > totalUnpaid * 0.25) {
      const error = badRequest({detail: 'Amount is more than 25% of the total of jobs that are unpaid'});
      return sendError(error, res);
    }

    // 4. Deposit money
    await Profile.update({balance: profile.balance + depositAmount}, {where: {id: userId}});

    return res.status(200).json({message: 'Deposit successful'});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});


/** **_GET_** `/admin/best-profession?start=<date>&end=<date>` - Returns the profession that earned the most money (sum of jobs paid) for any contactor that worked in the query time range.
 */
app.get('/admin/best-profession', [getProfile, validateStartAndEndDates], async (req, res) => {
  const {start, end} = req.query,
    startDate = new Date(start),
    endDate = new Date(end);

  try {
    // Group payments by contractor for the given time range
    // Example: [{ContractorId: 1, totalPaid: 100}, {ContractorId: 2, totalPaid: 200}]
    const paymentsByContractor = await groupPaymentsByContractor(startDate, endDate);

    console.log('paymentsByContractor', paymentsByContractor);

    if (paymentsByContractor.length === 0) {
      const error = notFound('No jobs found for the given time range');
      return sendError(error, res);
    }

    // Group payments by profession using paymentsByContractor
    // Example: {Programmer: 100, Musician: 200}
    const paymentsByProfession = await groupPaymentsByProfession(paymentsByContractor);
    console.log('paymentsByProfession', paymentsByProfession);

    // Get the profession with the highest totalPaid
    const paymentsByProfessionArray = Object.entries(paymentsByProfession),
      sortedPaymentsByProfessionArray = paymentsByProfessionArray.sort((a, b) => {return b[1] - a[1];}),
      [highestPayingProfession, ] = sortedPaymentsByProfessionArray[0];

    return res.json({result: highestPayingProfession});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});

/**
 * **_GET_** `/admin/best-clients?start=<date>&end=<date>&limit=<integer>`
 */
app.get('/admin/best-clients', [getProfile, validateStartAndEndDates], async (req, res) => {
  const {start, end, limit = 2} = req.query,
    startDate = new Date(start),
    endDate = new Date(end);

  try {
    // Get client payment map for the given time range sorted by totalPaid in descending order
    // Example: [{ClientId: 1, totalPaid: 200}, {ClientId: 2, totalPaid: 100}]
    const paymentsByClient = await groupPaymentsByClient(startDate, endDate);

    if (paymentsByClient.length === 0) {
      const error = notFound('No jobs found for the given time range');
      return sendError(error, res);
    }

    // Add full name to the paymentsByClient map
    await addClientDetailsToPayments(paymentsByClient);


    return res.json({result: paymentsByClient.slice(0, limit)});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});


module.exports = app;
