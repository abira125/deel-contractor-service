class CustomError extends Error {
  constructor(name, message, detail, statusCode, ...args) {
    super(...args);

    if ((typeof name !== 'string' && typeof name !== 'undefined') ||
        (typeof message !== 'string' && typeof message !== 'undefined') ||
        (typeof statusCode !== 'number' && typeof statusCode !== 'undefined')){
      return;
    }

    this.message = message;
    this.statusCode = statusCode;
    this.name = name;
    this.detail = detail;
    Error.captureStackTrace(this, CustomError);
  }
}

module.exports = CustomError;
