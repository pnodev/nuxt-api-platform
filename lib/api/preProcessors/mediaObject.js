import { v4 as uuidv4 } from 'uuid';

export default async function (value, axios) {
  if (value === null) {
    return value;
  }
  if (typeof value === 'object' && value.base64) {
    const { data } = await axios.post(
      '/api/media_objects',
      {
        id: uuidv4(),
        base64: value.base64,
        caption: value.caption,
        sort: value.sort,
      },
      {
        headers: {
          'Content-Type': 'application/ld+json',
          Accept: 'application/ld+json',
        },
      }
    );
    return data['@id'];
  } else if (Array.isArray(value)) {
    value = await Promise.all(
      value.map(async (file) => {
        if (typeof file === 'object' && file.base64) {
          const { data } = await axios.post('/api/media_objects', {
            id: uuidv4(),
            caption: file.caption,
            sort: file.sort,
            base64: file.base64,
          });
          return data['@id'];
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
