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
  {serverError, unauthorizedError, notFound, sendError} = require('./helper/Errors');

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

module.exports = app;
