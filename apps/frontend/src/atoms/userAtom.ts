import { atom } from 'recoil';

export type User = {
  id: string;
  name: string;
  roomId: string;
};

const storedUser =
  typeof window !== "undefined" ? window.localStorage.getItem("livecodex-user") : null;

export const userAtom = atom<User >({
  key: 'userAtom',
  default: storedUser ? JSON.parse(storedUser) : {id: "", name: "", roomId: ""},
});
