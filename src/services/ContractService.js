const {Op} = require('sequelize'),
  async = require('async');

const {Profile, Contract, Job, sequelize} = require('../model'),
  {concurrenctTasks} = require('../config/env/production');

const getActiveContractsForProfile = async (profile) => {
  try {
    // Get profile id
    const {id: profileId, type: profileType} = profile;

    // Get all contracts for that profile Id: Both as a contractor and a client?
    const asKeyword =  profileType === 'contractor' ? 'Contractor': 'Client';

    const profileWithContracts = await Profile.findOne({
      where: { id: profileId},
      include: [{
        model: Contract,
        as: asKeyword,
        where: {
          status: {
            [Op.in]: ['in_progress', 'new']// 'terminated'
          }
        }
      }]
    });

    const contracts = profileWithContracts ? profileWithContracts[asKeyword]: [];

    return contracts;
  } catch (error) {
    throw error;
  }

};

const getUnpaidJobsForContracts = async (contractIds) => {

  // ToDo: Parallelize vs IN query
  // For each contract get all unpaid (paid=false) jobs
  // const unpaidJobs = [];
  // async.mapLimit(contractIds, 3, (contractId) => {
  //     Job
  // })
  try {
    const unpaidJobs = await Job.findAll({
      where: {
        [Op.and]: [
          {paid: false},
          {ContractId: {[Op.in]: contractIds}}
        ]
      }
    });
    const jobs = unpaidJobs ? unpaidJobs: [];
    return jobs;
  } catch (error) {
    throw error;
  }
};

const getJobAndContractByJobId = async (jobId) => {
  const jobWithContract = await Job.findOne({
    where: {
      id: jobId
    },
    include: [{
      model: Contract,
      as: 'Contract'
    }]
  });

  return jobWithContract;
};

const makePaymentForJob = async (clientProfile, contract, job, amountToPay) => {
  // Transaction
  await sequelize.transaction(async(t) => {
    // Deduct from client
    await clientProfile.update({balance: clientProfile.balance - amountToPay}, {transaction: t});

    // Add to contractor
    const contractorProfile = await Profile.findOne({where: {id: contract.ContractorId}}, {transaction: t});
    await contractorProfile.update({balance: contractorProfile.balance + amountToPay}, {transaction: t});

    // Update job
    await job.update({paid: true, paymentDate: Date.now()}, {transaction: t});
  });
};

const groupPaymentsByContractor = async (startDate, endDate) => {
  // Get contractor payment map for the given time range
  // Example: [{ContractorId: 1, totalPaid: 100}, {ContractorId: 2, totalPaid: 200}]
  const contractorPaymentMap = await Contract.findAll({
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

  return contractorPaymentMap;
};

const groupPaymentsByProfession = async (paymentsByContractor) => {
  const professionPayMap = {};
  const prepareMap = async.mapLimit(paymentsByContractor, concurrenctTasks, async (contractorPayment) => {
    const {profession: contractorProfession} = await Profile.findOne({where: {id: contractorPayment.ContractorId}});

    if(professionPayMap[contractorProfession]) {
      professionPayMap[contractorProfession] += contractorPayment.totalPaid;
    } else {
      professionPayMap[contractorProfession] = contractorPayment.totalPaid;
    }
  });

  await prepareMap;

  return professionPayMap;
};

const groupPaymentsByClient = async (startDate, endDate) => {
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

  return clientPaymentMap;
};

const addClientDetailsToPayments = async (paymentsByClient) => {

  const prepareMapPromise = async.mapLimit(paymentsByClient, concurrenctTasks, async (clientPayment) => {
    const {firstName, lastName} = await Profile.findOne({where: {id: clientPayment.ClientId}});
    const fullName = `${firstName} ${lastName}`;

    clientPayment.fullName = fullName;
  });

  await prepareMapPromise;
};

module.exports = {
  getActiveContractsForProfile,
  getUnpaidJobsForContracts,
  getJobAndContractByJobId,
  makePaymentForJob,
  groupPaymentsByContractor,
  groupPaymentsByProfession,
  groupPaymentsByClient,
  addClientDetailsToPayments
};
