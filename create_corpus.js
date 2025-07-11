require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs').promises;
const fetch = require('node-fetch');

const CSV_FILE_PATH = 'Student Sample Data - Student Data.csv';
const PDF_FILE_PATH = 'student_sample_data.pdf';
const SQL_FILE_PATH = 'sample_quiz_data.sql';

async function createRagCorpus(projectId, location, displayName) {
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const corpus = {
    displayName: displayName,
  };

  const response = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/ragCorpora`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpus),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create RAG corpus: ${JSON.stringify(error)}`);
  }

  const result = await response.json();
  console.log('Successfully created RAG corpus:', result);
  return result;
}

async function uploadFile(projectId, location, corpusName, filePath, displayName) {
    const auth = new GoogleAuth({
        scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    const fileContents = await fs.readFile(filePath, 'base64');

    const response = await fetch(
        `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/ragCorpora/${corpusName}/ragFiles`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ragFile: {
                    displayName: displayName,
                    ragFileChunkingConfig: {
                        chunk_size: 1024,
                    },
                    file: {
                        inline: {
                            data: fileContents,
                            mimeType: getMimeType(filePath),
                        }
                    }
                }
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to upload file: ${JSON.stringify(error)}`);
    }

    const result = await response.json();
    console.log('Successfully uploaded file:', result);
    return result;
}


async function main() {
    const projectId = process.env.PROJECT_ID;
    const location = 'us-central1';
    const displayName = `GABTA Corpus ${Date.now()}`;

    try {
        const corpus = await createRagCorpus(projectId, location, displayName);
        const corpusName = corpus.name.split('/').pop();

        await uploadFile(projectId, location, corpusName, CSV_FILE_PATH, 'Student Data');
        await uploadFile(projectId, location, corpusName, PDF_FILE_PATH, 'Student Sample Data');
        await uploadFile(projectId, location, corpusName, SQL_FILE_PATH, 'Sample Quiz Data');

        console.log('All files uploaded successfully!');
    } catch (error) {
        console.error(error.message);
    }
}

main();