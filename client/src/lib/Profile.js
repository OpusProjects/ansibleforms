import axios from 'axios';
import TokenStorage from './TokenStorage';

const Profile = {
  async load() {
    try {
      const result = await axios.get(`/api/v2/profile`, TokenStorage.getAuthentication());
      return result.data;
    } catch {
      // ignore... if the 401 is hit, the TokenStorage will redirect to the login page
    }
  },
};

export default Profile;
