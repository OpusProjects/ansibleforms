import passport from 'passport';
import authConfig from '../../config/auth.config.js';
import logger from '../lib/logger.js';
import { Strategy as JWTstrategy, ExtractJwt as ExtractJWT } from 'passport-jwt';
import { isRevoked } from '../lib/tokenRevocation.js';

passport.use(
  new JWTstrategy(
    {
      secretOrKey: authConfig.secret,
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken()
    },
    async (jwtPayload, done) => {
      try {
        if(jwtPayload.access){
          // its session logged out, or its user changed the password since it was issued
          if (await isRevoked(jwtPayload)) return done(null, false, { message: 'Token revoked' });
          return done(null, jwtPayload);
        }else {
          done(null, false,{message:'Bad accesstoken'})
        }
      } catch (error) {
        logger.info("error ?")
        done(error,false,{message:'Unknown JWT error'});
      }
    }
  )
);
