#!/usr/bin/env node
// Operator tool for payments. Not deployed; run locally with the production database URL:
//   DATABASE_URL='postgres://…' node tools/payments-admin.mjs list
//   … resolve <orderId> paid "<bank reference you saw>"   money arrived in the account → grant the install
//   … resolve <orderId> retry "<note>"                    reopen so the customer can resend the same slip
//   … grant <mcsvServerId> "<note>"                       entitle a server installed before payments existed
import { paymentStore, database } from '../web/join/lib/payments.js';

const [command, ...args] = process.argv.slice(2);
const store = paymentStore();
try {
  if (command === 'list') {
    const rows = await store.review();
    if (!rows.length) console.log('No orders waiting for review.');
    for (const o of rows) console.log([o.id, o.status, (o.amount_satang / 100).toFixed(2) + ' THB', o.method || '-', o.error_code || '-', o.server_name || o.server_id, o.user_name || o.user_id, new Date(o.created_at).toISOString()].join('  '));
  } else if (command === 'resolve' && args.length === 3) {
    console.log('Order', args[0], '->', await store.resolve(args[0], args[1], args[2]));
  } else if (command === 'grant' && args.length === 2) {
    console.log('Granted server', args[0], 'order', await store.grant(args[0], args[1]));
  } else {
    console.log('Usage: list | resolve <orderId> paid|retry "<note>" | grant <serverId> "<note>"');
    process.exitCode = 2;
  }
} catch (error) {
  console.error('Failed:', error.code || error.message);
  process.exitCode = 1;
} finally {
  await database().end();
}
