/**
 * @fileOverview
 * This file contains all the configurations that are specific to production environment.
 */

module.exports = {
  concurrentTasks: process.env.CONCURRENT_TASKS || 10
};

