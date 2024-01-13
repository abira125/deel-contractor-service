const CustomError = require('./CustomError'),
  // logger = require('../../config/log'),

  ERROR_STRINGS = {
    BAD_REQUEST: 'Bad Request',
    INVALID_REQUEST: 'Invalid request',
    INVALID_PARAM: 'Invalid parameter',
    PARAM_MISSING: 'Parameter missing',
    SERVER_ERROR: 'Internal Server Error',
    NOT_FOUND: 'Not Found'
  };

const createError = (name, message, detail, statusCode, ...args) => {
  return new CustomError(name, message, detail, statusCode, ...args);
};

const badRequest = (options = {}) => {
  const {
    name = 'BadRequest',
    message = 'Invalid request',
    detail,
  } = options;
  return createError(name, message, detail, 400);
};

const invalidParam =  function (message) {
  return badRequest({
    message : 'Invalid parameter',
    detail: message
  });
};

const paramMissing = function (message, detail) {
  return badRequest({
    name: 'ParamMissing',
    message,
    detail,
  });
};

const serverError = function () {
  return createError('ServerError', 'Internal Server Error', null, 500);
};

const notFound = function (message) {
  return createError('NotFound', message, null, 404);
};

const sendError = function (error, res) {
  const statusCode = error.statusCode || 500;
  const errorResponse = {
    'status': statusCode,
    'error': {
      code : error.name || 'ServerError',
      message: error.message || 'Internal Server Error'
    }
  };

  if (error.detail) {
    errorResponse.error.detail = error.detail;
  }

  res.status(statusCode).json(errorResponse);
};

module.exports = {
  badRequest,
  invalidParam,
  paramMissing,
  serverError,
  notFound,
  sendError,
  ERROR_STRINGS
};
