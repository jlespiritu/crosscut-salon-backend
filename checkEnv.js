require('dotenv').config();

console.log('PG_HOST:', process.env.PG_HOST);
console.log('PG_PORT:', process.env.PG_PORT);
console.log('PG_DATABASE:', process.env.PG_DATABASE);
console.log('PG_USER:', process.env.PG_USER);
console.log('PG_PASSWORD:', process.env.PG_PASSWORD ? '(may laman, tinago ko)' : 'WALANG LAMAN/UNDEFINED');