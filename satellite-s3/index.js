const S3rver = require('s3rver');
const { fromEvent } = require('rxjs');
const { filter } = require('rxjs/operators');
const fs = require('fs');
const corsConfig = require.resolve('s3rver/example/cors.xml');
const websiteConfig = require.resolve('s3rver/example/website.xml');

let authToken = 'automa25'
let bucketName = 'satellite-1'
let port = 4569
let address = '0.0.0.0'
let directory = './buckets'

const instance = new S3rver({
  port: port,
  address: address,
  silent: false,
  directory: directory,
  accessKeyId:authToken,
  secretAccessKey:authToken,
  configureBuckets: [
    {
      name: bucketName,
      accessKeyId: authToken,
      secretAccessKey: authToken,
      cors: fs.readFileSync(corsConfig),
      website: fs.readFileSync(websiteConfig),
    },
  ],
}).run((err, { address, port } = {}) => {
  if (err) {
    console.error(err);
  } else {
    console.log('now listening at address %s and port %d', address, port);
  }
});

const s3Events = fromEvent(instance, 'event');
s3Events.subscribe((event) => console.log(event));
s3Events
  .pipe(filter((event) => event.Records[0].eventName == 'ObjectCreated:Copy'))
  .subscribe((event) => console.log(event));