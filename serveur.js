// server.js
const express = require('express');
const cors = require('cors');
const dialogflow = require('@google-cloud/dialogflow');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// --- HELPER FUNCTION ---
// A helper function to convert Dialogflow's complex Struct format to simple JSON
function structToJson(struct) {
  if (!struct || !struct.fields) {
    // This handles cases where the value is already simple (e.g., inside a list)
    if (struct && struct.structValue) return structToJson(struct.structValue);
    if (struct && struct.stringValue) return struct.stringValue;
    // Add other types if needed, or return the struct itself
    return struct;
  }

  const json = {};
  for (const key in struct.fields) {
    const field = struct.fields[key];
    const kind = field.kind;

    switch (kind) {
      case 'stringValue':
        json[key] = field.stringValue;
        break;
      case 'numberValue':
        json[key] = field.numberValue;
        break;
      case 'boolValue':
        json[key] = field.boolValue;
        break;
      case 'nullValue':
        json[key] = null;
        break;
      case 'listValue':
        json[key] = field.listValue.values.map(value => structToJson(value));
        break;
      case 'structValue':
        json[key] = structToJson(field.structValue);
        break;
      default:
        json[key] = field;
    }
  }
  return json;
}


// --- DIALOGFLOW CONFIG ---
const projectId = 'nomadia-chatbot-hjcj';

// Parse the credentials from the environment variable
const credentialsJson = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const sessionClient = new dialogflow.SessionsClient({
  projectId,
  credentials: {
    private_key: credentialsJson.private_key,
    client_email: credentialsJson.client_email,
  },
});

// --- API ROUTE ---
app.post('/send-message', async (req, res) => {
  const { text, sessionId } = req.body;
  const session = sessionId || uuidv4();
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, session);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: text,
        languageCode: 'fr-FR',
      },
    },
  };

  try {
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;

    // --- THIS IS THE KEY CHANGE ---
    // Instead of sending the raw 'result', we build a clean object.
    const cleanQueryResult = {
      fulfillmentText: result.fulfillmentText,
      intent: { // We only take what we need from the intent
        displayName: result.intent.displayName,
        name: result.intent.name,
      },
      // We convert the complex parameters object into simple JSON
      parameters: structToJson(result.parameters),
      // We also convert the custom payloads in fulfillmentMessages
      fulfillmentMessages: result.fulfillmentMessages.map(msg => {
        if (msg.payload) {
          return { payload: structToJson(msg.payload) };
        }
        return msg; // Return other message types (like simple text) as they are
      }),
    };
    
    console.log('Cleaned Dialogflow response sent to client.');

    res.json({
      queryResult: cleanQueryResult,
      sessionId: session,
    });
    
  } catch (error) {
    console.error('DIALOGFLOW ERROR:', error);
    res.status(500).send(error);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});