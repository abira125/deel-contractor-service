const express = require('express');
const bodyParser = require('body-parser');
const {Op} = require('sequelize');
const async = require('async');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

const {getActiveContracts} = require('./services/ContractService'),
  {serverError, unauthorizedError, notFound, badRequest, sendError} = require('./helper/Errors');

/**
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
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

    res.json(contract);
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }

});

/**
 * @returns contracts
 */
app.get('/contracts/', getProfile, async (req, res) => {
  // Get all contracts for the given profile id
  // ToDo: Don't pass req

  try {
    const contracts = await getActiveContracts(req.profile);
    return res.json({ contracts});
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }
});

/**
 * Gets unpaid jobs for a user
 */
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const {Job} = req.app.get('models');

  try {
    // Get all active contracts
    const contracts = await getActiveContracts(req.profile),
      contractIds = contracts.map((contract) => {
        return contract.id;
      });

    if (contractIds.length === 0) {
      return res.json({unpaidJobs: []});
    }

    // ToDo: Parallelize vs IN query
    // For each contract get all unpaid (paid=false) jobs
    // const unpaidJobs = [];
    // async.mapLimit(contractIds, 3, (contractId) => {
    //     Job
    // })

    const unpaidJobs = await Job.findAll({
      where: {
        [Op.and]: [
          {paid: false},
          {ContractId: {[Op.in]: contractIds}}
        ]
      }
    });
    return res.json({unpaidJobs});
  } catch (error) {
    console.error(error);
    return sendError(serverError(), res);
  }

});

/** Allows you to pay for a job given a job id
 *
*/
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  const {profile: clientProfile} = req,
    {amount_to_pay: payAmount} = req.body,
    {job_id: jobId} = req.params,
    {Job, Contract, Profile} = req.app.get('models');

  // ToDo: idempotence, refactor
  try {
    // Paying profile should be a client
    if (clientProfile.type !== 'client') {
      return sendError(unauthorizedError(), res);
    }

    const job = await Job.findOne({where: {
      id: jobId
    }});

    const contract = await Contract.findOne({where: {
      id: job.ContractId
    }});

    // Job should belong to the client
    const clientId = contract.ClientId;
    if (clientProfile.id !== clientId) {
      const error = unauthorizedError('You are not elligible to pay for this job');
      return sendError(error, res);
    }

    // Check for sufficient balance
    if (clientProfile.balance < payAmount) {
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

    // Transaction
    await sequelize.transaction(async(t) => {
      await clientProfile.update({balance: clientProfile.balance - payAmount}, {transaction: t});

      const contractorProfile = await Profile.findOne({where: {id: contract.ContractorId}}, {transaction: t});
      await contractorProfile.update({balance: contractorProfile.balance + payAmount}, {transaction: t});

      // ToDo: Settle only if payment is complete
      await job.update({paid: true}, {transaction: t});
    });

    return res.status(200).json({message: 'Payment successful'});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});

/** Deposit money */
app.post('/balances/deposit/:userId', getProfile, async (req, res) => {
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

  // ToDo: Idempotence
  try {

    // Check if the amount is more than 25% of the total of jobs that are unpaid

    // 1. Get all active contracts
    const contracts = await getActiveContracts(profile, req);
    const contractIds = contracts.map((contract) => {
      return contract.id;
    });

    // 2. Get total price of all unpaid jobs for the given contracts
    const {Job} = req.app.get('models');
    const unpaidJobs = await Job.findAll({
      where: {
        [Op.and]: [
          {paid: false},
          {ContractId: {[Op.in]: contractIds}}
        ]
      }
    });

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


/** Get the best paying profession in a given time range */
app.get('/admin/best-profession', async (req, res) => {
  const {start, end} = req.query;
  const {Job, Profile, Contract} = req.app.get('models');

  const startDate = new Date(start);
  const endDate = new Date(end);
  try {
    // Get contractor payment map for the given time range
  // Example: [{ContractorId: 1, totalPaid: 100}, {ContractorId: 2, totalPaid: 200}]
    const contractorPaymentArray = await Contract.findAll({
      attributes: [
        'ContractorId',
        [sequelize.fn('SUM', sequelize.col('jobs.price')), 'totalPaid']
      ],
      include: [{
        model: Job,
        attributes: [], // No attributes from Job are directly selected
        where: {
          createdAt: {
            [Op.gt]: startDate, // greater than start date
            [Op.lt]: endDate   // less than end date
          },
          paid: true
        }
      }],
      group: ['Contract.ContractorId'], // Group by ContractorId
      raw: true // This ensures the output is not nested
    });

    if (contractorPaymentArray.length === 0) {
      const error = notFound('No jobs found for the given time range');
      return sendError(error, res);
    }

    // Transform per contractor payment to per profession payment map
    const professionPayMap = {};
    const prepareMap = async.mapLimit(contractorPaymentArray, 10, async (contractorPayment) => {
      const {profession: contractorProfession} = await Profile.findOne({where: {id: contractorPayment.ContractorId}});

      if(professionPayMap[contractorProfession]) {
        professionPayMap[contractorProfession] += contractorPayment.totalPaid;
      } else {
        professionPayMap[contractorProfession] = contractorPayment.totalPaid;
      }
    });

    await prepareMap;

    //   console.log('professionPayMap', professionPayMap);
    const professionalPayArray = Object.entries(professionPayMap);
    const [profession, ] = professionalPayArray.sort((a, b) => {return b[1] - a[1];})[0];

    return res.json({result: profession});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});

/**
 * Get the best client
 */
app.get('/admin/best-clients', async (req, res) => {
  const {start, end, limit = 2} = req.query;
  const {Job, Profile, Contract} = req.app.get('models');
  const startDate = new Date(start);
  const endDate = new Date(end);

  try {
    // Get client payment map for the given time range sorted by totalPaid in descending order
    // Example: [{ClientId: 1, totalPaid: 100}, {ClientId: 2, totalPaid: 200}]
    const clientPaymentMap = await Contract.findAll({
      attributes: [
        'ClientId',
        [sequelize.fn('SUM', sequelize.col('jobs.price')), 'totalPaid']
      ],
      include: [{
        model: Job,
        attributes: [], // No attributes from Job are directly selected
        where: {
          createdAt: {
            [Op.gt]: startDate, // greater than start date
            [Op.lt]: endDate   // less than end date
          },
          paid: true
        }
      }],
      group: ['Contract.ClientId'], // Group by ClientId
      raw: true, // This ensures the output is not nested,
      order: [
        [sequelize.col('totalPaid'), 'DESC']
      ]
    });

    if (clientPaymentMap.length === 0) {
      const error = notFound('No jobs found for the given time range');
      return sendError(error, res);
    }

    // Add full name to the clientPaymentMap
    const prepareMap = async.mapLimit(clientPaymentMap, 10, async (clientPayment) => {
      const {firstName, lastName} = await Profile.findOne({where: {id: clientPayment.ClientId}});
      const fullName = `${firstName} ${lastName}`;

      clientPayment.fullName = fullName;
    });

    await prepareMap;

    //console.log('clientPayMap', clientPaymentMap);

    return res.json({result: clientPaymentMap.slice(0, limit)});
  } catch (error) {
    console.log(error);
    return sendError(serverError(), res);
  }
});


module.exports = app;
