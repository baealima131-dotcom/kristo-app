export type Product = {
  id: string;
  title: string;
  category: string;
  price: number;
  currency: "TZS" | "BIF" | "USD";
  location: string;
  image: string;
  condition: "New" | "Used";
  seller: {
    id: string;
    kristoId?: string;
    name: string;
    verified: boolean;
    church: string;
    avatarUri?: string;
  };
};

export type ChatMessage = {
  id: string;
  text: string;
  mine: boolean;
  time: string;
};
