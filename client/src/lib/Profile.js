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
  // how an account signs in, readable and with an icon : the profile page and the user menu
  loginType(t, type) {
    const types = {
      local: { label: t('profilePage.localAccount'), icon: 'house-user' },
      ldap: { label: 'LDAP', icon: 'address-book' },
      azuread: { label: 'Azure AD', icon: 'fab,microsoft' },
      oidc: { label: 'OpenID Connect', icon: 'fab,openid' },
    };
    return types[type] || { label: type || '', icon: 'user' };
  },
};

export default Profile;
