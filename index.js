require('dotenv').config();
const axios = require('axios');
const express = require('express');
const { google } = require('googleapis');
const { Queue, Worker } = require('bullmq');

// Replace Anthropic with Groq API
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Gmail OAuth Configuration
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

const getGmailOAuthURL = () => {
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  });
};

const setGmailCredentials = (tokens) => {
  oAuth2Client.setCredentials(tokens);
};

const getGmailClient = () => google.gmail({ version: 'v1', auth: oAuth2Client });

// Function to analyze email content using **Groq API**
const analyzeEmailContent = async (content) => {
  try {
    const response = await axios.post(
      'https://api.groq.com/v1/chat/completions',
      {
        model: "mixtral-8x7b-32768",
        messages: [
          { role: "user", content: `Categorize the following email content. Output only one number: "${content}"\n\nCategories:\n1 if Interested, 2 if Not Interested, 3 if More Information` }
        ],
        max_tokens: 5,
      },
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error analyzing email content:", error);
  }
};

// Function to generate email responses using **Groq API**
const generateEmailResponse = async (content) => {
  try {
    const response = await axios.post(
      'https://api.groq.com/v1/chat/completions',
      {
        model: "mixtral-8x7b-32768",
        messages: [
          { role: "user", content: `Generate a polite email response for this email: "${content}"` }
        ],
        max_tokens: 150,
      },
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating email response:", error);
  }
};

// Fetch and send emails remain unchanged

// Outlook Authentication Configuration
const clientId = process.env.OUTLOOK_CLIENT_ID;
const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
const redirectUri = process.env.OUTLOOK_REDIRECT_URI;
const scope = 'https://graph.microsoft.com/.default';

let outlookTokens = null;

// Function to get OAuth URL for Outlook
const getOutlookOAuthURL = () => {
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}&response_mode=query`;
};

const fetchOutlookMessages = async () => {
  try {
    const res = await axios.get('https://graph.microsoft.com/v1.0/me/messages', {
      headers: { Authorization: `Bearer ${outlookTokens.access_token}` }
    });
    return res.data.value;
  } catch (error) {
    console.error('Error fetching Outlook messages:', error.message);
    throw error;
  }
};

// Function to handle incoming emails
const handleGmailWebhook = async () => {
  const messages = await fetchGmailMessages();
  for (const message of messages) {
    const email = await fetchGmailMessage(message.id);
    const emailContent = Buffer.from(email.payload.parts[0].body.data, 'base64').toString('utf-8');
    const classification = await analyzeEmailContent(emailContent);

    let response = "";
    switch (classification) {
      case '1':
        response = await generateEmailResponse("Would you like to hop on a demo call?");
        await sendGmailMessage("Thank you for showing interest", response);
        break;
      case '2':
        response = "Thank you for your time.";
        await sendGmailMessage("Dear User", "Thank you for your time.");
        break;
      case '3':
        response = "Can you please provide more details?";
        await sendGmailMessage("Dear User", "Tell us how we can assist you.");
        break;
    }
  }
};

const app = express();
const port = process.env.PORT || 3000;
app.use(express.static(__dirname));

app.get('/auth/gmail', (req, res) => {
  res.redirect(getGmailOAuthURL());
});

app.get('/auth/gmail/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);
  setGmailCredentials(tokens);
  res.sendFile(__dirname + "/gmail.html");
});

app.get('/auth/outlook', (req, res) => {
  res.redirect(getOutlookOAuthURL());
});

app.get('/auth/outlook/callback', async (req, res) => {
  const code = req.query.code;
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  try {
    const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
      client_id: clientId,
      scope: scope,
      code: code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      client_secret: clientSecret,
    }));

    outlookTokens = tokenResponse.data;
    res.sendFile(__dirname + "/outlook.html");

  } catch (error) {
    console.error('Error authenticating Outlook:', error.message);
    res.status(500).send('Error authenticating Outlook');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:3000/`);
});
