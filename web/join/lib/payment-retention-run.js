import {database} from './payments.js';
import {cleanPaymentHistory} from './payment-retention.js';
try{console.log('PAYMENT_RETENTION_OK '+JSON.stringify(await cleanPaymentHistory()));}catch{console.error('PAYMENT_RETENTION_FAILED');process.exitCode=1;}finally{await database().end();}
