const { invalidParam, sendError, paramMissing } = require('../helper/Errors');

const validateContractId = (req, res, next) => {
  // Check that contractid is a number
  const contractId = req.params.id;
  if (!contractId) {
    return sendError(paramMissing('Contract id is missing'), res);
  }

  if (isNaN(contractId)) {
    return sendError(invalidParam('Contract id should be a number'), res);
  }
  next();
};

const validateStartAndEndDates = (req, res, next) => {
  // Extract from and to dates from query params
  const { start, end } = req.query;

  // Both start and end dates should be present
  if (!start || !end) {
    return sendError(paramMissing('Start and end dates are required'), res);
  }

  // Check that start and end dates are valid. date should be an ISO string
  if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    return sendError(invalidParam('Start and end dates should be valid ISO string dates'), res);
  }

  // Check that start date is before end date
  if (new Date(start) > new Date(end)) {
    return sendError(invalidParam('Start date should be before end date'), res);
  }
  next();
};

const validateJobId = (req, res, next) => {
  // Check that jobid is a number
  const jobId = req.params.job_id;
  if (!jobId) {
    return sendError(paramMissing('Job id is missing'), res);
  }

  if (isNaN(jobId)) {
    return sendError(invalidParam('Job id should be a number'), res);
  }
  next();
};

const validateUserId = (req, res, next) => {
  // Check that userid is a number
  const userId = req.params.userId;
  if (!userId) {
    return sendError(paramMissing('User id is missing'), res);
  }

  if (isNaN(userId)) {
    return sendError(invalidParam('User id should be a number'), res);
  }
  next();
};

const validateAmountToDeposit = (req, res, next) => {
  // Check that amount is a number
  const amount = req.body.amount_to_deposit;
  if (!amount) {
    return sendError(paramMissing('Amount is missing'), res);
  }

  if (isNaN(amount)) {
    return sendError(invalidParam('Amount should be a number'), res);
  }
  next();
};



module.exports = { validateContractId, validateStartAndEndDates, validateJobId, validateUserId, validateAmountToDeposit };
