const {unauthorizedError, sendError} = require('../helper/Errors');

const getProfile = async (req, res, next) => {
  const {Profile} = req.app.get('models');
  console.log('req.get', req.get('profile_id'));
  const profile = await Profile.findOne({where: {id: req.get('profile_id') || 0}});
  if(!profile) {return sendError(unauthorizedError(), res);}
  req.profile = profile;
  next();
};
module.exports = {getProfile};
