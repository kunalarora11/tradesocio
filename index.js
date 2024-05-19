import express from 'express';
import NodeCache from 'node-cache';
import axios from 'axios';
import cron from 'node-cron';

const app = express();

const externalAPIURL = 'https://externalAPI.com/'

// Cache duration: 10 minutes, delete expired entries, check for expired entries every minute
const cache = new NodeCache({ stdTTL: 600, deleteOnExpire: true, checkperiod: 60 });


// Function to fetch data from the external API
const fetchDataFromAPI = async (symbol, period, startTime, endTime) => {
    try {
        const response = await axios.get(externalAPIURL, {
            params: { symbol, period, start: startTime, end: endTime }
        });
        return response.data;
    } catch (error) {
        throw new Error('Failed to fetch data from external API');
    }
};

// Function to refresh cache periodically for current data
const refreshCachePeriodically = async () => {
    try {
        const currentTime = new Date().toISOString();
        const symbol = 'AAPL';
        const period = '1min';
        const startTime = new Date(Date.now() - 60000).toISOString();
        const endTime = currentTime;

        // Fetching the data from external API
        const currentData = await fetchDataFromAPI(symbol, period, startTime, endTime);
        
        // Update cache with current data
        cache.set('currentData', currentData);
    } catch (error) {
        console.error('Error refreshing cache:', error.message);
    }
};

// Schedule cache refresh task every minute
cron.schedule('0 * * * * *', refreshCachePeriodically);

// Function to handle requests and caching
app.get('/timeseries', async (req, res) => {
    const { symbol, period, start, end } = req.query;

    if (!symbol || !period || !start || !end) {
        return res.status(400).json({ error: 'Symbol, period, start time, and end time are required' });
    }

    const cacheKey = `${symbol}-${period}-${start}-${end}`;
    let cachedData = cache.get(cacheKey);

    if (cachedData) {
        // Cache hit: return cached data
        return res.json(cachedData);
    }

    // Check if parts of the requested data are in the cache
    const cacheIntervals = determineCacheIntervals(symbol, period, start, end);
    let missingIntervals = [];

    for (const interval of cacheIntervals) {
        const intervalData = cache.get(interval.key);
        if (intervalData) {
            cachedData = cachedData ? [...cachedData, ...intervalData] : intervalData;
        } else {
            missingIntervals.push(interval);
        }
    }

    try {
        if (missingIntervals.length > 0) {
            for (const interval of missingIntervals) {
                const intervalData = await fetchDataFromAPI(symbol, period, interval.start, interval.end);
                cache.set(interval.key, intervalData, 600);
                cachedData = cachedData ? [...cachedData, ...intervalData] : intervalData;
            }
        }

        res.json(cachedData);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch data from external API' });
    }
});

// Function to determine cache intervals based on request parameters
const determineCacheIntervals = (symbol, period, start, end) => {
    const intervals = [];
    let intervalStart = new Date(start);
    while (intervalStart < new Date(end)) {
        let intervalEnd;
        switch (period) {
            case '1min':
                intervalEnd = new Date(intervalStart.getTime() + 60000); // 1 minute interval
                break;
            case '5min':
                intervalEnd = new Date(intervalStart.getTime() + 300000); // 5 minute interval
                break;
            case '1hour':
                intervalEnd = new Date(intervalStart.getTime() + 3600000); // 1 hour interval
                break;
            case '1day':
                intervalEnd = new Date(intervalStart.getTime() + 86400000); // 1 day interval
                break;
            default:
                intervalEnd = new Date(end);
                break;
        }
        intervals.push({ key: `${symbol}-${period}-${intervalStart.toISOString()}-${intervalEnd.toISOString()}`, start: intervalStart.toISOString(), end: intervalEnd.toISOString() });
        intervalStart = intervalEnd;
    }
    return intervals;
};


// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
