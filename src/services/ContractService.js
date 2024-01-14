const {Op} = require('sequelize');
const {Profile, Contract} = require('../model');

const getActiveContracts = async (profile) => {
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

module.exports = {
  getActiveContracts
};
