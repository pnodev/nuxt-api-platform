import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import { getExtension } from 'mime';

/**
 * Converts a base64 String to blobfile
 *
 * @param {string} dataURI Base64 String
 * @returns {object} The created blobfile
 */
function dataURItoBlob(dataURI) {
  // convert base64/URLEncoded data component to raw binary data held in a string
  let byteString;
  if (dataURI.split(',')[0].includes('base64')) {
    byteString = atob(dataURI.split(',')[1]);
  } else {
    byteString = unescape(dataURI.split(',')[1]);
  }

  // separate out the mime component
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to a typed array
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i += 1) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ia], { type: mimeString });
}
/**
 * Creates an AWS-Client communicating with Minio instance
 *
 * @returns {object} The AWS-Client
 */
function createAwsClient() {
  return new AWS.S3({
    accessKeyId: process.env.minioUser,
    secretAccessKey: process.env.minioPassword,
    endpoint: process.env.minioApi,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  });
}

/**
 * Uploads a blobfile into a specified bucket in Minio storage.
 *
 * @param {object} client AWS-client
 * @param {object} params contains params for upload (bucket, filename, blobfile, contentType)
 */
async function uploadFile(client, params) {
  await new Promise((resolve, reject) => {
    client.putObject(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

export default async function (value, axios) {
  if (value === null) {
    return value;
  }
  if (typeof value === 'object' && !value.base64) {
    return null;
  }
  if (typeof value === 'object' && value.base64) {
    const client = createAwsClient();

    const blob = dataURItoBlob(value.base64);

    const fileID = uuidv4();
    const fileExtension = getExtension(blob.type);

    const params = {
      Bucket: process.env.minioBucket,
      Key: fileID + '.' + fileExtension,
      Body: blob,
      ContentType: blob.type,
    };

    await uploadFile(client, params);

    return `${process.env.minioBucket}/${fileID}.${fileExtension}`;
  } else if (Array.isArray(value)) {
    value = await Promise.all(
      value.map(async (file) => {
        if (typeof file === 'object' && file.base64) {
          const client = createAwsClient();
          const blob = dataURItoBlob(file.base64);

          const fileID = uuidv4();
          const fileExtension = getExtension(blob.type);

          const params = {
            Bucket: process.env.minioBucket,
            Key: fileID + '.' + fileExtension,
            Body: blob,
            ContentType: blob.type,
          };

          await uploadFile(client, params);

          return `${process.env.minioBucket}/${fileID}.${fileExtension}`;
        } else if (typeof file === 'object') {
          delete file.contentUrl;
          delete file.createdAt;
          delete file.updatedAt;
          await axios.patch(file['@id'], file, {
            headers: {
              'Content-Type': 'application/merge-patch+json',
              Accept: 'application/ld+json',
            },
          });
          return file['@id'];
        }
        return file;
      })
    );
  } else if (typeof value === 'object') {
    delete value.contentUrl;
    delete value.createdAt;
    delete value.updatedAt;
    await axios.patch(value['@id'], value, {
      headers: {
        'Content-Type': 'application/merge-patch+json',
        Accept: 'application/ld+json',
      },
    });
    return value['@id'];
  }
  return value;
}
