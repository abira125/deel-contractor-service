const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize);
app.set('models', sequelize.models);

const {getActiveContracts} = require('./services/ContractService');

/**
 * @returns contract by id
 */
app.get('/contracts/:id',getProfile ,async (req, res) =>{
  const {Contract} = req.app.get('models'),
    {id} = req.params,
    {id: profileId, type: profileType} = req.profile;

  const contract = await Contract.findOne({where: {id}});

  if (profileType === 'contractor' && profileId !== contract.ContractorId) {
    return res.status(401).end();
  }

  if (profileType === 'client' && profileId !== contract.ClientId) {
    return res.status(401).end();
  }

  if(!contract) {return res.status(404).end();}
  res.json(contract);
});

/**
 * @returns contracts
 */
app.get('/contracts/', getProfile, async (req, res) => {
  // Get all contracts for the given profile id
  // ToDo: Don't pass req
  const contracts = await getActiveContracts(req.profile, req);

  // Return response
  res.json({ contracts});
});

module.exports = app;
