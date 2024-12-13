const express = require('express');
const Redis = require('ioredis');
const { AWS_REGION, REDIS_HOST, REDIS_PORT } = require("./config");
// Replace with your Redis configuration
const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    tls: {}, // Enable TLS
});

const app = express();
app.use(express.json());


// Add clientId and clientSecret to Redis
app.post('/add-clients', async (req, res) => {
    const clients = req.body; // Expecting array of clientId & clientSecret pairs
    if (!Array.isArray(clients) || clients.length === 0) {
        return res.status(400).json({ message: 'Invalid request: Send an array of clientId & clientSecret' });
    }

    try {
        const results = await Promise.all(
            clients.map(async ({ clientId, clientSecret }) => {
                if (!clientId || !clientSecret) {
                    return { clientId, status: 'Invalid', reason: 'Missing clientId or clientSecret' };
                }

                try {
                    await redis.set(clientId, JSON.stringify({ clientSecret }));
                    return { clientId, status: 'Added' };
                } catch (error) {
                    console.error('Redis set error:', error);
                    return { clientId, status: 'Failed', reason: 'Redis error' };
                }
            })
        );

        res.status(200).json(results);
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Handle incoming requests for multiple clientId and clientSecret validation
app.post('/validate', async (req, res) => {
    const clients = req.body; // Expecting a direct array of clientId and clientSecret pairs

    if (!Array.isArray(clients) || clients.length === 0) {
        return res.status(400).json({ message: 'Invalid request: An array of clientId and clientSecret pairs is required' });
    }

    // Map over each pair and validate
    try {
        const validationResults = await Promise.all(
            clients.map(async ({ clientId, clientSecret }) => {
                if (!clientId || !clientSecret) {
                    return { clientId, status: 'Invalid', reason: 'clientId and clientSecret are required' };
                }

                try {
                    const storedData = await redis.get(clientId);

                    if (storedData) {
                        const { clientSecret: storedSecret } = JSON.parse(storedData);

                        if (storedSecret === clientSecret) {
                            return { clientId, status: 'Valid' };
                        }
                    }

                    return { clientId, status: 'Invalid', reason: 'clientSecret mismatch or clientId not found' };
                } catch (error) {
                    console.error('Error fetching data from Redis:', error);
                    return { clientId, status: 'Invalid', reason: 'Internal server error' };
                }
            })
        );

        res.status(200).json(validationResults);
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Health check route
app.get('/health', (req, res) => res.status(200).send('Server is healthy'));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
