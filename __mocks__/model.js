const mockFindOne = jest.fn();

const mockContract = {
  findOne: mockFindOne
};

module.exports = {
  Contract: mockContract
};
