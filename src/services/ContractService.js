const {Op} = require('sequelize'),
  async = require('async'),
  _ = require('lodash');

const {Profile, Contract, Job, sequelize} = require('../model'),
  {concurrentTasks} = require('../config/env/production');

/**
 * Get all active contracts for a profile
 * @param {Object} profile
 * @returns in_progress contracts for the profile
 */
const getActiveContractsForProfile = async (profile) => {
  try {
    // Get profile id
    const {id: profileId, type: profileType} = profile;

    // Get all contracts for that profile Id: Both as a contractor and a client?
    const asKeyword =  profileType === 'contractor' ? 'Contractor': 'Client';

    //ToDo: Pick only the required fields. SELECT * not a good idea
    const profileWithContracts = await Profile.findOne({
      where: { id: profileId},
      include: [{
        model: Contract,
        as: asKeyword,
        where: {
          status: {
            [Op.in]: ['in_progress']
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

/**
 * Get all non terminated contracts for a profile
 * @param {Object} profile
 * @returns non terminated contracts for the profile
 */
const getNonTerminatedContractsForProfile = async (profile) => {
  try {
    // Get profile id
    const {id: profileId, type: profileType} = profile;

    // Get all contracts for that profile Id: Both as a contractor and a client?
    const asKeyword =  profileType === 'contractor' ? 'Contractor': 'Client';

    //ToDo: Pick only the required fields. SELECT * not a good idea
    const profileWithContracts = await Profile.findOne({
      where: { id: profileId},
      include: [{
        model: Contract,
        as: asKeyword,
        where: {
          status: {
            [Op.in]: ['in_progress', 'new']
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


/**
 * Get all unpaid jobs for a list of contracts
 * @param {Array} contractIds
 * @returns unpaid jobs for the contracts
 */
const getUnpaidJobsForContracts = async (contractIds) => {
  // ToDo: Use IN query with chunking like in groupPaymentsByProfession for better performance and control over concurrency
  // ToDo: Pick only the required fields. SELECT * not a good idea
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

/**
 * Get job and contract for a job id
 * @param {Number} jobId
 * @returns job and contract for the job id
 */
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

/**
 * Make payment for a job. Transfers money from client to contractor. Ergo a transaction
 * @param {Object} clientProfile
 * @param {Object} contract
 * @param {Object} job
 * @param {Number} amountToPay
 */
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

/**
 * Group payments by contractor
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns payments grouped by contractorId
 * // Example: [{ContractorId: 1, totalPaid: 100}, {ContractorId: 2, totalPaid: 200}]
 */
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

/**
 * Group payments by profession
 * @param {Array} paymentsByContractor
 * @returns payments grouped by profession
 * // Example: {programmer: 100, musician: 200}
 */
const groupPaymentsByProfession = async (paymentsByContractor) => {
  if (!Array.isArray(paymentsByContractor)) {
    return {};
  }

  if (paymentsByContractor.length === 0) {
    return {};
  }

  const professionPayMap = {};

  const contractorIds = paymentsByContractor.map((contractorPayment) => contractorPayment.ContractorId);
  const contractorIdsChunks = _.chunk(contractorIds, 5);

  // Get all contractor profiles
  // Bulk in query instead of single query for each contractor for better performance
  // Chunked contractorIds for better control over concurrency as the query can get unbounded
  const contractorProfiles = [];
  await async.mapLimit(contractorIdsChunks, concurrentTasks, async (contractorIdsChunk) => {
    try {
      const contractorProfilesChunk = await Profile.findAll({
        attributes: ['id', 'profession'],
        where: {
          id: {
            [Op.in]: contractorIdsChunk
          }
        }
      });
      contractorProfiles.push(...contractorProfilesChunk);
    } catch (error) {
      throw error;
    }
  });

  // Group payments by profession
  paymentsByContractor.forEach((contractorPayment) => {
    const {ContractorId: contractorId} = contractorPayment;
    const contractorProfile = contractorProfiles.find((profile) => profile.id === contractorId);
    const {profession: contractorProfession} = contractorProfile;

    if (professionPayMap[contractorProfession]) {
      professionPayMap[contractorProfession] += contractorPayment.totalPaid;
    } else {
      professionPayMap[contractorProfession] = contractorPayment.totalPaid;
    }
  });

  return professionPayMap;
};

/**
 * Group payments by client
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns payments grouped by client
 * // Example: [{ClientId: 1, totalPaid: 100}, {ClientId: 2, totalPaid: 200}]
 */
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
          [Op.gt]: startDate,
          [Op.lt]: endDate
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

/**
 * Add client details to payments
 * @param {Array} paymentsByClient
 * @returns payments with client details
 * // Example: [{ClientId: 1, totalPaid: 100, fullName: 'John Doe'}, {ClientId: 2, totalPaid: 200, fullName: 'Jane Doe'}]
 */
const addClientDetailsToPayments = async (paymentsByClient) => {
  // ToDo: Use IN query with chunking like in groupPaymentsByProfession
  const prepareMapPromise = async.mapLimit(paymentsByClient, concurrentTasks, async (clientPayment) => {
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
  addClientDetailsToPayments,
  getNonTerminatedContractsForProfile
};
