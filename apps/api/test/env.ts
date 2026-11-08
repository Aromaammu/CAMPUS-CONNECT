import 'reflect-metadata';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://cc:cc_local_dev@127.0.0.1:5433/cc_test';
process.env.DISABLE_JOBS = '1';
