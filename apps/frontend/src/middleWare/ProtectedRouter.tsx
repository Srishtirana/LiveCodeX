import { useRecoilValue } from "recoil";
import { userAtom } from "../atoms/userAtom";
import { Navigate, useParams } from "react-router-dom";

const ProtectedRouter = ({ children }: any) => {
  const user = useRecoilValue(userAtom);
  const parms = useParams();
  const storedUser =
    typeof window !== "undefined"
      ? window.localStorage.getItem("livecodex-user")
      : null;
  const persistedUser = storedUser ? JSON.parse(storedUser) : null;
  const activeUser = user.id ? user : persistedUser;
  const isEnteringRequestedRoom =
    activeUser?.id && activeUser?.roomId && activeUser.roomId === parms.roomId;

  return (
    isEnteringRequestedRoom ? children : <Navigate to={`/${parms.roomId}`} />
  )
};

export default ProtectedRouter;
