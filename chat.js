const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const { MongoClient,ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'DELETE'],  
  credentials: true
}));

app.use(express.json());

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const generation_config = {
  "temperature": 1,
  "top_p": 0.95,
  "top_k": 64,
  "max_output_tokens": 8192,
  "response_mime_type": "text/plain",
}

const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro",
  generationConfig:generation_config,
  system_instruction:"SYSTEM MESSAGE...",
  safetySettings });

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('Industrial_Startup_Chatbot');
    cachedDb = db;
    return db;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

async function cleanupOldConversations() {
  try {
    const db = await connectToDatabase();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const result = await db.collection('conversations').deleteMany({
      'messages.timestamp': { $lt: oneHourAgo }
    });
    console.log(`Cleaned up ${result.deletedCount} old conversations`);
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

setInterval(cleanupOldConversations, 60 * 60 * 1000);

app.post('/api/chat', async (req, res) => {
  try {
    const db = await connectToDatabase();
    const { message, conversationId } = req.body;
    const prompt = `Provide information about industrial startups related to: ${message}. Focus on recent trends, innovations, and potential impact on the industry.You are a chatbot developed to provide details about Industry startups using the google gemini api.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let conversation;
    if (conversationId) {
      conversation = await db.collection('conversations').findOneAndUpdate(
        { _id: new ObjectId(conversationId) },
        { $push: { messages: { userMessage: message, botResponse: text, timestamp: new Date() } } },
        { returnDocument: 'after' }
      );
    } else {
      conversation = await db.collection('conversations').insertOne({
        messages: [{ userMessage: message, botResponse: text, timestamp: new Date() }]
      });
    }

    res.status(200).json({ reply: text, conversationId: conversation.insertedId || conversationId });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});

app.delete('/api/chat/conversation/:id', async (req, res) => {  
  try {
    const db = await connectToDatabase();
    const result = await db.collection('conversations').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 1) {
      res.status(200).json({ message: 'Conversation deleted successfully' });
    } else {
      res.status(404).json({ error: 'Conversation not found' });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while deleting the conversation.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  cleanupOldConversations(); 
});