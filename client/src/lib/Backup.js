import axios from 'axios';
import TokenStorage from './TokenStorage';

const Backup = {
  async load() {
    try {
      const result = await axios.get(
        `/api/v2/config/backups?timestamp=${new Date().getTime()}`,
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
      throw new Error(`Could not get the backups.\n\n${errorMessage}`, { cause: err });
    }
  },
  async restore(backupName, backupBeforeRestore) {
    try {
      await axios.post(
        `/api/v2/config/restore/${backupName}?backupBeforeRestore=${backupBeforeRestore}`,
        {},
        TokenStorage.getAuthentication(),
      );
      return true;
    } catch (err) {
      if (err.response?.status == 401) {
        throw new Error(err.message, { cause: err });
      }
      const error = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;
      const errorMessage = details ? `${error}\n\n${details}` : error;
      throw new Error(`Could not restore the backup.\n\n${errorMessage}`, { cause: err });
    }
  },
};

export default Backup;
