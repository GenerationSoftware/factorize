import { BuiltinSkillError } from "../../skills/builtin-skills";

import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";

import { ServiceError } from "../../api-service";

export const resourceAction=async<T>(action:()=>Promise<T>):Promise<T>=> {
      try{return await action();}catch(error){
        if(error instanceof BuiltinSkillError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,error.message);
        if(error instanceof ServiceError)throw new ProtocolError(ProtocolErrorCode.InvalidParams,`${error.code}: ${error.message}`);
        throw error;
      }
    };

export const eventAction = async <T>(action: () => Promise<T>): Promise<T> => {
      try { return await action(); }
      catch (error) {
        if (error instanceof ServiceError && (error.status === 401 || error.status === 403)) {
          throw new ProtocolError(-32024, error.message);
        }
        if (error instanceof ProtocolError) throw error;
        throw new ProtocolError(ProtocolErrorCode.InternalError, "Factorize could not complete this Events request.");
      }
    };
