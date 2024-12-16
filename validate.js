const express = require('express');
const Redis = require('ioredis');
const fs = require('fs');
const { MongoClient } = require('mongodb');

const { AWS_REGION, REDIS_HOST, REDIS_PORT, MONGO_URI, MONGO_DB_NAME } = require("./config");

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  tls: {}, // Enable TLS
});

const mongoClient = new MongoClient(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

let mongoDb;
mongoClient.connect().then(client => {
  mongoDb = client.db(MONGO_DB_NAME);
  console.log("Connected to MongoDB Atlas");
}).catch(err => {
  console.error("Error connecting to MongoDB Atlas:", err);
});

const app = express();
app.use(express.json());

// Add clientId and clientSecret to Redis
app.post('/add-clients', async (req, res) => {
    const clients = Array.isArray(req.body) ? req.body : [req.body];

    if (clients.length === 0 || !clients[0].clientId || !clients[0].clientSecret) {
        const errorMessage = { message: 'Invalid request: Send clientId and clientSecret or an array of such objects' };
        logToFile({
            timestamp: new Date().toISOString(),
            action: 'add-clients',
            status: 'failed',
            details: errorMessage,
        });
        return res.status(400).json(errorMessage);
    }

    try {
        const results = await Promise.all(
            clients.map(async ({ clientId, clientSecret }) => {
                if (!clientId || !clientSecret) {
                    const result = { clientId, status: 'Invalid', reason: 'Missing clientId or clientSecret' };
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'add-clients',
                        result,
                    });
                    return result;
                }

                try {
                    await redis.set(clientId, JSON.stringify({ clientSecret }));
                    const result = { clientId, status: 'Added' };
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'add-clients',
                        result,
                    });
                    return result;
                } catch (error) {
                    const result = { clientId, status: 'Failed', reason: 'Redis error' };
                    console.error('Redis set error:', error);
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'add-clients',
                        result,
                    });
                    return result;
                }
            })
        );

        res.status(200).json(results);
    } catch (error) {
        console.error('Error processing request:', error);
        logToFile({
            timestamp: new Date().toISOString(),
            action: 'add-clients',
            status: 'failed',
            reason: 'Internal server error',
        });
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Handle incoming requests for single or multiple clientId and clientSecret validation
app.post('/validate', async (req, res) => {
    const clients = Array.isArray(req.body) ? req.body : [req.body];

    if (clients.length === 0 || !clients[0].clientId || !clients[0].clientSecret) {
        const errorMessage = { message: 'Invalid request: Provide clientId and clientSecret or an array of such objects' };
        logToFile({
            timestamp: new Date().toISOString(),
            action: 'validate',
            status: 'failed',
            details: errorMessage,
        });
        return res.status(400).json(errorMessage);
    }

    try {
        const validationResults = await Promise.all(
            clients.map(async ({ clientId, clientSecret, ...additionalData }) => {
                if (!clientId || !clientSecret) {
                    const result = {
                        clientId,
                        status: 'Invalid',
                        reason: 'clientId and clientSecret are required',
                    };
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'validate',
                        result,
                    });
                    return result;
                }

                try {
                    const storedData = await redis.get(clientId);

                    if (storedData) {
                        const { clientSecret: storedSecret } = JSON.parse(storedData);

                        if (storedSecret === clientSecret) {
                            const result = { clientId, status: 'Valid' };
                            logToFile({
                                timestamp: new Date().toISOString(),
                                action: 'validate',
                                result,
                            });

                            // Store the validated data in MongoDB Atlas
                            if (mongoDb) {
                                await mongoDb.collection('validated_clients').insertOne({
                                    clientId,
                                    clientSecret,
                                    ...additionalData,
                                    validatedAt: new Date(),
                                });
                            } else {
                                console.error('MongoDB client is not initialized');
                            }

                            return result;
                        }
                    }

                    const result = {
                        clientId,
                        status: 'Invalid',
                        reason: 'clientSecret mismatch or clientId not found',
                    };
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'validate',
                        result,
                    });
                    return result;
                } catch (error) {
                    const result = {
                        clientId,
                        status: 'Invalid',
                        reason: 'Internal server error',
                    };
                    logToFile({
                        timestamp: new Date().toISOString(),
                        action: 'validate',
                        result,
                    });
                    console.error('Error fetching data from Redis:', error);
                    return result;
                }
            })
        );

        res.status(200).json(validationResults);
    } catch (error) {
        console.error('Error processing request:', error);
        logToFile({
            timestamp: new Date().toISOString(),
            action: 'validate',
            status: 'failed',
            reason: 'Internal server error',
        });
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Logging function
function logToFile(logData) {
    const logFile = 'validation-log.json';
    fs.appendFile(logFile, JSON.stringify(logData, null, 2) + '\n', (err) => {
        if (err) console.error('Error writing log to file:', err);
    });
}

// Health check route
app.get('/health', (req, res) => res.status(200).send('Server is healthy'));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
