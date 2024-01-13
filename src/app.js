const express = require('express');
const bodyParser = require('body-parser');
const {Op} = require('sequelize');
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
    const contracts = await getActiveContracts(req.profile, req);
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
    const contracts = await getActiveContracts(req.profile, req),
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

module.exports = app;
