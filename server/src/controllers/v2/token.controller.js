'use strict';
import RestResult from '../../models/restResult.model.v2.js';
import jwt from "jsonwebtoken";
import authConfig from '../../../config/auth.config.js';
import logger from "../../lib/logger.js";
import Token from "../../models/token.model.js";
import User from "../../models/user.model.js";
import i18n from '../../lib/i18n.js';
import { isRevoked } from '../../lib/tokenRevocation.js';

const refresh = async function(req, res) {
    try {
        // get the refresh token
        const refreshtoken = req.body.refreshtoken;
        logger.info("requesting refresh token");
        
        if(!refreshtoken){
            logger.error("no refresh token is provided");
            return res.status(400).json(RestResult.error(i18n.t(req, 'errors.provideRefreshToken')));
        }
        
        // VERIFY, not decode. The signature was never checked, so the stored row was the
        // only authority - which meant rotating ACCESS_TOKEN_SECRET invalidated nothing,
        // contradicting what the settings page and the Status page both tell the operator.
        // A stolen refresh token kept minting valid access tokens under the NEW secret.
        // Expiry is enforced by verify() too, so the manual exp check below is now a
        // belt-and-braces path for a token that verify accepted.
        let jwtPayload;
        try {
            jwtPayload = jwt.verify(refreshtoken, authConfig.secret, { issuer: authConfig.jwtIssuer });
        } catch (e) {
            logger.error(`Refresh token rejected : ${e.message}`);
            return res.status(401).json(RestResult.error(i18n.t(req, 'errors.invalidRefreshToken')));
        }

        if(!jwtPayload || !jwtPayload.user || !jwtPayload.refresh){
            logger.error("Invalid refresh token");
            return res.status(401).json(RestResult.error(i18n.t(req, 'errors.invalidRefreshToken')));
        }
        
        const username = jwtPayload.user.username;
        const username_type = jwtPayload.user.type;

        // its session logged out, or its user changed the password since : no new tokens
        if (await isRevoked(jwtPayload)) {
            logger.warning(`Refresh refused for ${username} : the session was ended`);
            await Token.delete(username, username_type, refreshtoken).catch(() => {});
            return res.status(401).json(RestResult.error(i18n.t(req, 'errors.invalidRefreshToken')));
        }
        
        await Token.check(username, username_type, refreshtoken);
        
        if(new Date(jwtPayload.exp*1000) <= new Date()){
            logger.error("Refresh token is expired");
            await Token.delete(username, username_type, refreshtoken);
            logger.info("Removed token for " + username);
            return res.status(401).json(RestResult.error(i18n.t(req, 'errors.refreshTokenExpired')));
        }
        
        // Re-resolve the roles and options instead of copying the ones frozen at login.
        // They used to be re-signed verbatim for ever, so removing a user from a group or
        // stripping a role in config.yaml never took effect - they kept minting admin
        // access tokens one refresh at a time. Now a change lands within the access
        // token's lifetime. getRolesAndOptions degrades to safe defaults if the config
        // cannot be read, so a broken config cannot silently escalate anyone.
        const body = { ...jwtPayload.user };
        try {
            const ro = await User.getRolesAndOptions(body.groups || [], body);
            body.roles = ro.roles;
            body.options = ro.options;
        } catch (e) {
            logger.error(`Could not re-resolve roles on refresh for ${username} : ${e.message}`);
            return res.status(401).json(RestResult.error(i18n.t(req, 'errors.refreshTokenUnknown')));
        }

        // the same session : a logout still ends what this refresh hands out
        const sid = jwtPayload.sid;
        const token = jwt.sign({ user: body, access:true, sid }, authConfig.secret, { expiresIn: authConfig.jwtExpiration, issuer: authConfig.jwtIssuer });
        const newRefreshtoken = jwt.sign({ user: body, refresh:true, sid }, authConfig.secret, { expiresIn: authConfig.jwtRefreshExpiration, issuer: authConfig.jwtIssuer });

        await Token.store(username, username_type, newRefreshtoken);
        // Single use : the old row stayed valid, so a stolen refresh token kept working
        // alongside the new one indefinitely. Deleted AFTER the new one is stored, so a
        // failure here cannot leave the user with no usable token at all.
        await Token.delete(username, username_type, refreshtoken);
        logger.info("Token is renewed and stored");
        
        res.json(RestResult.single({ token, refreshtoken: newRefreshtoken }));
        
    } catch(err) {
        logger.error(`Error : ${err.toString()}`);
        res.status(401).json(RestResult.error(i18n.t(req, 'errors.refreshTokenUnknown')));
    }
};

export default {
  refresh
}
