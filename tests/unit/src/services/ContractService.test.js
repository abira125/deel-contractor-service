const { groupPaymentsByProfession, groupPaymentsByClient } = require('../../../../src/services/ContractService');
const { Contract, Profile} = require('../../../../src/model');

jest.mock('../../../../src/model');


describe('groupPaymentsByProfession', () => {
  it('returns payments grouped by profession', async () => {
    const paymentsByContractor = [
      { ContractorId: 1, totalPaid: 100 },
      { ContractorId: 2, totalPaid: 200 },
      { ContractorId: 1, totalPaid: 300 },
      { ContractorId: 3, totalPaid: 400 },
      { ContractorId: 2, totalPaid: 500 },
      { ContractorId: 3, totalPaid: 600 },
    ];

    // Resolve mock to return profession programmer for ContractorId 2
    Profile.findOne.mockImplementation((query) => {
      if (query.where.id === 1) {
        return Promise.resolve({ profession: 'musician' });
      } else if (query.where.id === 2) {
        return Promise.resolve({ profession: 'programmer' });
      } else if (query.where.id === 3) {
        return Promise.resolve({ profession: 'wizard' });
      }
      return Promise.resolve(null);
    });


    const professionPayMap = await groupPaymentsByProfession(paymentsByContractor);
    console.log('professionPayMap', professionPayMap);

    expect(professionPayMap).toEqual({
      'musician': 400,
      'programmer': 700,
      'wizard': 1000
    });
  });

  it('returns empty object if paymentsByContractor is empty', async () => {
    const paymentsByContractor = [];

    const professionPayMap = await groupPaymentsByProfession(paymentsByContractor);

    expect(professionPayMap).toEqual({});
  });

  it('returns empty object if paymentsByContractor is null', async () => {
    const paymentsByContractor = null;

    const professionPayMap = await groupPaymentsByProfession(paymentsByContractor);

    expect(professionPayMap).toEqual({});
  });
});

describe('groupPaymentsByClient', () => {
  it('returns payments grouped by client', async () => {
    Contract.findAll.mockResolvedValue([{ ClientId: 1, totalPaid: 200 }, { ClientId: 2, totalPaid: 100 }]);

    const clientPayMap = await groupPaymentsByClient(new Date(), new Date());

    expect(clientPayMap).toEqual([{ ClientId: 1, totalPaid: 200 }, { ClientId: 2, totalPaid: 100 }]);
  });

  it('returns empty object if no jobs with clients found for time range', async () => {
    Contract.findAll.mockResolvedValue([]);

    const clientPayMap = await groupPaymentsByClient(new Date(), new Date());

    expect(clientPayMap).toEqual([]);
  });
});
