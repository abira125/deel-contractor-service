const {Op} = require('sequelize');

const getActiveContracts = async (profile, req) => {
    const {Profile, Contract} = req.app.get('models');

    // Get profile id
    const {id: profileId, type: profileType} = profile;


    // Get all contracts for that profile Id: Both as a contractor and a client?
    const asKeyword =  profileType === 'contractor' ? 'Contractor': 'Client'

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
    })


    const contracts = profileWithContracts ? profileWithContracts[asKeyword]: [];
    console.log('contracts', contracts);

    return contracts;
}

module.exports = {
    getActiveContracts
}