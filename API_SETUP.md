# Kinopoisk API Setup Guide

This guide will help you set up the Kinopoisk API for the Movie Rating Extension.

## Getting API Key

1. **Visit Kinopoisk API Documentation**
   - Go to [https://kinopoiskdev.readme.io/](https://kinopoiskdev.readme.io/)
   - Read the documentation to understand the API

2. **Register for API Access**
   - Visit [https://kinopoisk.dev/](https://kinopoisk.dev/)
   - Sign up for an account
   - Request API access (usually free tier available)

3. **Get Your API Key**
   - Once approved, you'll receive an API key
   - Copy the key for configuration

## Configuration

### Step 1: Update Configuration File

Open `src/config/kinopoisk.config.js` and replace the placeholder:

```javascript
const KINOPOISK_CONFIG = {
    // Replace this with your actual API key
    API_KEY: 'YOUR_ACTUAL_API_KEY_HERE',
    
    // Other configuration remains the same
    BASE_URL: 'https://api.kinopoisk.dev/v1.4',
    // ...
};
```

### Step 2: Verify Configuration

The extension will automatically check if the API key is configured. You can verify this by:

1. Opening the extension popup
2. Checking the browser console for any API configuration errors
3. Testing the search functionality

## API Limits and Quotas

### Free Tier Limits
- **Requests per day**: Usually 100-1000 requests
- **Rate limiting**: 1-10 requests per second
- **Data retention**: Limited historical data

### Paid Tier Benefits
- Higher request limits
- Faster response times
- Access to more detailed data
- Priority support

## API Endpoints Used

The extension uses the following Kinopoisk API endpoints:

### 1. Movie Search
- **Endpoint**: `GET /movie/search`
- **Purpose**: Search for movies by title
- **Parameters**:
  - `query`: Search term
  - `page`: Page number (pagination)
  - `limit`: Results per page
  - `sortField`: Sort by popularity (`votes.kp`)
  - `sortType`: Sort order (`1` for descending)

### 2. Movie Details
- **Endpoint**: `GET /movie/{id}`
- **Purpose**: Get detailed information about a specific movie
- **Parameters**:
  - `id`: Kinopoisk movie ID

## Error Handling

The extension handles common API errors:

### 1. Authentication Errors
- **Error**: `401 Unauthorized`
- **Cause**: Invalid or missing API key
- **Solution**: Check your API key configuration

### 2. Rate Limiting
- **Error**: `429 Too Many Requests`
- **Cause**: Exceeded rate limit
- **Solution**: Wait before making more requests

### 3. Quota Exceeded
- **Error**: `403 Forbidden`
- **Cause**: Daily quota exceeded
- **Solution**: Wait until next day or upgrade plan

### 4. Movie Not Found
- **Error**: `404 Not Found`
- **Cause**: Movie ID doesn't exist
- **Solution**: Check movie ID validity

## Caching Strategy

The extension implements intelligent caching to minimize API usage:

### 1. Movie Cache
- Movies are cached in Firestore for 24 hours
- Reduces API calls for repeated searches
- Automatic cache cleanup for expired entries

### 2. Search Results
- Search results are cached temporarily
- Prevents duplicate API calls for same query
- Cache duration: 1 hour

### 3. Cache Management
- Automatic cleanup of expired cache
- Manual cache refresh available
- Cache statistics in developer console

## Testing API Integration

### 1. Test Search Functionality
1. Open the extension popup
2. Sign in with your account
3. Click "Advanced Search"
4. Search for a popular movie (e.g., "The Matrix")
5. Verify results are displayed

### 2. Test Movie Rating
1. Find a movie in search results
2. Click on the movie
3. Rate the movie (1-10)
4. Add an optional comment
5. Save the rating
6. Verify it appears in the feed

### 3. Check Console Logs
Open browser developer tools and check for:
- API configuration messages
- Request/response logs
- Error messages
- Cache hit/miss statistics

## Troubleshooting

### Common Issues

#### 1. "API key not configured" Error
**Solution**: 
- Check `src/config/kinopoisk.config.js`
- Ensure API key is properly set
- Restart the extension

#### 2. "Search failed" Error
**Possible causes**:
- Invalid API key
- Network connectivity issues
- Rate limiting
- Quota exceeded

**Solutions**:
- Verify API key is correct
- Check internet connection
- Wait and try again
- Check API quota usage

#### 3. No Search Results
**Possible causes**:
- API key not working
- Search query too specific
- API service issues

**Solutions**:
- Test with popular movie titles
- Check API status
- Verify API key permissions

#### 4. Slow Performance
**Possible causes**:
- Network latency
- API rate limiting
- Large result sets

**Solutions**:
- Check network connection
- Reduce search result limit
- Use cached results when possible

## Security Best Practices

### 1. API Key Protection
- Never commit API keys to version control
- Use environment variables in production
- Rotate keys regularly

### 2. Request Optimization
- Implement proper caching
- Use pagination for large results
- Avoid unnecessary API calls

### 3. Error Handling
- Graceful degradation on API failures
- User-friendly error messages
- Fallback to cached data when possible

## Support and Resources

### Documentation
- [Kinopoisk API Documentation](https://kinopoiskdev.readme.io/)
- [API Reference](https://kinopoisk.dev/api-docs)

### Community
- [GitHub Issues](https://github.com/your-repo/issues)
- [Discord Community](https://discord.gg/your-server)
- [Reddit Community](https://reddit.com/r/your-subreddit)

### Contact
- Email: support@your-domain.com
- GitHub: @your-username
- Twitter: @your-handle

## Changelog

### Version 1.0.0
- Initial API integration
- Basic search functionality
- Movie rating system
- Caching implementation

### Future Updates
- Advanced filtering options
- Batch operations
- Real-time updates
- Enhanced error handling
