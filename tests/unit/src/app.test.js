const request = require('supertest');
const app = require('../../../src/app'); // Adjust this to the correct path of your app
const { Contract } = require('../../../src/model'); // Adjust the path to your model
// const { getProfile } = require('../../../__mocks__/getProfile');
const { getProfile } = require('../../../src/middleware/getProfile');
const {getActiveContractsForProfile,
  getNonTerminatedContractsForProfile,
  getUnpaidJobsForContracts,
  getJobAndContractByJobId,
  makePaymentForJob,
  groupPaymentsByContractor,
  groupPaymentsByProfession,
  groupPaymentsByClient,
  addClientDetailsToPayments} = require('../../../src/services/ContractService');

jest.mock('../../../src/model'); // Mock the model
jest.mock('../../../src/services/ContractService');
jest.mock('../../../src/middleware/getProfile', () => ({
  getProfile: jest.fn().mockImplementation((req, res, next) => {
    // Default mock implementation
    req.profile = { id: 1, type: 'client' }; // Default mocked profile
    next();
  })
}));

describe.skip('GET /contracts/:id', () => {
  beforeAll(() => {
    jest.clearAllMocks();
  }
  );

  it('returns a contract for a valid id', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    const mockData = { id: 1, ClientId: 1, ContractorId: 5, status: 'terminated' };
    Contract.findOne.mockResolvedValue(mockData);

    const res = await request(app)
      .get('/contracts/1')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(200);
    console.log('resBody', res.body);
    expect(res.body.id).toEqual(1);
  });

  it('returns 404 if contract is not found', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    Contract.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get('/contracts/1')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(404);
  });

  it('returns 401 if contract does not belong to profile', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    const mockData = { id: 1, ClientId: 2, ContractorId: 5, status: 'terminated' };
    Contract.findOne.mockResolvedValue(mockData);

    const res = await request(app)
      .get('/contracts/1')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(401);
  });

  it('returns 500 if there is an error', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    Contract.findOne.mockRejectedValue(new Error('Error'));

    const res = await request(app)
      .get('/contracts/1')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(500);
  });
});

describe.skip('GET /contracts/', () => {
  beforeAll(() => {
    jest.clearAllMocks();
  }
  );

  it('returns in progress and new contracts for a valid profile', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    // Mock getNonTerminatedContractsForProfile

    const mockData = [{ id: 1, ClientId: 1, ContractorId: 5, status: 'in_progress' }, { id: 3, ClientId: 1, ContractorId: 5, status: 'new' }];
    getNonTerminatedContractsForProfile.mockResolvedValue(mockData);

    const res = await request(app)
      .get('/contracts/')
      .set('profile_id', 1);

    expect(res.statusCode).toEqual(200);
    console.log('resBody', res.body);
    expect(res.body.contracts.length).toEqual(2);
    // status is in_progress or new for all returned contracts
    expect(res.body.contracts[0].status).toEqual('in_progress');
    expect(res.body.contracts[1].status).toEqual('new');
    expect(res.body.contracts[0].id).toEqual(1);
    expect(res.body.contracts[1].id).toEqual(3);
  });

  it('returns 500 if there is an error', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    getNonTerminatedContractsForProfile.mockRejectedValue(new Error('Error'));

    const res = await request(app)
      .get('/contracts/')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(500);
  });

  it('returns empty array if there are no contracts', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    getNonTerminatedContractsForProfile.mockResolvedValue([]);

    const res = await request(app)
      .get('/contracts/')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(200);
    expect(res.body.contracts.length).toEqual(0);
  });
});


describe.skip('GET /jobs/unpaid', () => {
  beforeAll(() => {
    jest.clearAllMocks();
  }
  );

  it('returns unpaid jobs for a valid profile', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });

    // Mock getActiveContractsForProfile
    const mockContracts = [{ id: 1, ClientId: 1, ContractorId: 5, status: 'in_progress' }, { id: 3, ClientId: 1, ContractorId: 5, status: 'in_progress' }];
    getActiveContractsForProfile.mockResolvedValue(mockContracts);

    // Mock getUnpaidJobsForContracts
    const mockJobs = [{ id: 1, paid: false, ContractId: 1 }, { id: 2, paid: false, ContractId: 1 }];
    getUnpaidJobsForContracts.mockResolvedValue(mockJobs);

    const res = await request(app)
      .get('/jobs/unpaid')
      .set('profile_id', 1);

    expect(res.statusCode).toEqual(200);
    console.log('resBody', res.body);
    expect(res.body.unpaidJobs.length).toEqual(2);
    // status is in_progress or new for all returned contracts
    expect(res.body.unpaidJobs[0].paid).toEqual(false);
    expect(res.body.unpaidJobs[1].paid).toEqual(false);
    expect(res.body.unpaidJobs[0].id).toEqual(1);
    expect(res.body.unpaidJobs[1].id).toEqual(2);
  });

  it('returns 500 if there is an error', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });
    getActiveContractsForProfile.mockRejectedValue(new Error('Error'));

    const res = await request(app)
      .get('/jobs/unpaid')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(500);
  });

  it('returns empty array if there are no active contracts', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 1, type: 'client' }; // Custom mocked profile for this test
      next();
    });
    getActiveContractsForProfile.mockResolvedValue([]);

    const res = await request(app)
      .get('/jobs/unpaid')
      .set('profile_id', 1);
    expect(res.statusCode).toEqual(200);
    expect(res.body.unpaidJobs.length).toEqual(0);
  });

  it('returns empty array if there are no unpaid jobs', async () => {
    getProfile.mockImplementation((req, res, next) => {
      req.profile = { id: 2, type: 'contractor' }; // Custom mocked profile for this test
      next();
    });
    getActiveContractsForProfile.mockResolvedValue([{ id: 1, ClientId: 1, ContractorId: 2, status: 'in_progress' }]);
    getUnpaidJobsForContracts.mockResolvedValue([]);

    const res = await request(app)
      .get('/jobs/unpaid')
      .set('profile_id', 2);
    expect(res.statusCode).toEqual(200);
    expect(res.body.unpaidJobs.length).toEqual(0);
  });
});
