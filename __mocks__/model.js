const mockFindOneContract = jest.fn(),
  mockFindOneProfile = jest.fn();

const mockContract = {
  findOne: mockFindOneContract,
  findAll: jest.fn()
};

const mockProfile = {
  findOne: mockFindOneProfile
};


module.exports = {
  Contract: mockContract,
  Profile: mockProfile
};
