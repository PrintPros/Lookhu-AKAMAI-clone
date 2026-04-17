const fs = require('fs');

const content = fs.readFileSync('src/components/CloudflareSettings.tsx', 'utf8');

const masterApiRegex = /\{\/\* Master API Section \*\/\}.*?(?=\{\/\* Section A: Connected Buckets \*\/\})/s;
const connectedBucketsRegex = /\{\/\* Section A: Connected Buckets \*\/\}.*?(?=\{\/\* Section B: Scheduler Worker Deployment \*\/\})/s;
const schedulerRegex = /\{\/\* Section B: Scheduler Worker Deployment \*\/\}.*?(?=\{\/\* Section C: Channel Workers \*\/\})/s;
const channelWorkersRegex = /\{\/\* Section C: Channel Workers \*\/\}.*?(?=\{\/\* Section D: Add New Cloudflare Account \*\/\})/s;
const addNewAccountRegex = /\{\/\* Section D: Add New Cloudflare Account \*\/\}.*?(?=\{\/\* Section E: R2 Storage Overview \*\/\})/s;
const r2OverviewRegex = /\{\/\* Section E: R2 Storage Overview \*\/\}.*?(?=\{\/\* Dialogs \*\/\})/s;

const masterApiMatch = content.match(masterApiRegex);
const connectedBucketsMatch = content.match(connectedBucketsRegex);
const schedulerMatch = content.match(schedulerRegex);
const channelWorkersMatch = content.match(channelWorkersRegex);
const addNewAccountMatch = content.match(addNewAccountRegex);
const r2OverviewMatch = content.match(r2OverviewRegex);

if (!masterApiMatch || !connectedBucketsMatch || !schedulerMatch || !channelWorkersMatch || !addNewAccountMatch || !r2OverviewMatch) {
  console.error("Could not find all sections");
  process.exit(1);
}

const masterApi = masterApiMatch[0];
const connectedBuckets = connectedBucketsMatch[0];
const scheduler = schedulerMatch[0];
const channelWorkers = channelWorkersMatch[0];
const addNewAccount = addNewAccountMatch[0];
const r2Overview = r2OverviewMatch[0];

const newOrder = 
  r2Overview +
  connectedBuckets +
  addNewAccount +
  channelWorkers +
  masterApi +
  scheduler;

let newContent = content.replace(masterApiRegex, '')
  .replace(connectedBucketsRegex, '')
  .replace(schedulerRegex, '')
  .replace(channelWorkersRegex, '')
  .replace(addNewAccountRegex, '')
  .replace(r2OverviewRegex, newOrder);

fs.writeFileSync('src/components/CloudflareSettings.tsx', newContent);
console.log('Reordered successfully');
