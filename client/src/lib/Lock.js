import axios from 'axios';
import TokenStorage from './TokenStorage';

// Helper to extract API v2 error shape { error: message }
function extractError(err) {
  // Axios error response
  const data = err?.response?.data;
  if (data?.error) return data.error;
  if (typeof data === 'string') return data;
  return err.message || 'Unknown error';
}

const Lock = {
  // GET lock status (API v2 preferred). Returns pure object on success, throws on error.
  async get() {
    const res = await axios.get(`/api/v2/lock`, TokenStorage.getAuthentication());
    // v2 returns the object directly from RestResult.single
    return res.data; // { lock, match, free } OR { free: true }
  },
  async set() {
    try {
      const res = await axios.post(`/api/v2/lock`, {}, TokenStorage.getAuthentication());
      return res.data; // { message: 'Lock added' }
    } catch (err) {
      throw new Error(`Lock set failed: ${extractError(err)}`, { cause: err });
    }
  },
  async release() {
    try {
      const res = await axios.delete(`/api/v2/lock`, TokenStorage.getAuthentication());
      return res.data; // { message: 'Lock deleted' } or { message: 'Lock not present', deleted:false }
    } catch (err) {
      throw new Error(`Lock release failed: ${extractError(err)}`, { cause: err });
    }
  },
};

export default Lock;
