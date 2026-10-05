import axios from 'axios';
import TokenStorage from './TokenStorage';

const Form = {
  async loadAll() {
    try {
      const result = await axios.get(
        `/api/v2/config?timestamp=${new Date().getTime()}`,
        TokenStorage.getAuthentication(),
      );
      return result.data;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not load the forms.\n\n${errorMessage}`, { cause: err });
    }
  },

  async load(name) {
    try {
      const result = await axios.get(
        `/api/v2/config/form?name=${encodeURIComponent(name)}&timestamp=${new Date().getTime()}`,
        TokenStorage.getAuthentication(),
      );
      return result.data;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not load the form.\n\n${errorMessage}`, { cause: err });
    }
  },

  async list() {
    try {
      const result = await axios.get(
        `/api/v2/config/formlist?timestamp=${new Date().getTime()}`,
        TokenStorage.getAuthentication(),
      );
      return result.data;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not load the forms list.\n\n${errorMessage}`, { cause: err });
    }
  },

  async save(forms) {
    try {
      await axios.post(`/api/v2/config`, { forms }, TokenStorage.getAuthentication());
      return true;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not save the forms.\n\n${errorMessage}`, { cause: err });
    }
  },
  async validate(forms) {
    try {
      await axios.post(`/api/v2/config/check`, { forms }, TokenStorage.getAuthentication());
      return true;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not validate the forms.\n\n${errorMessage}`, { cause: err });
    }
  },
};

export default Form;
