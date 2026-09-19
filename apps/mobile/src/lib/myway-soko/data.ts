import { Product } from "./types";

export const categories = ["All", "Fashion", "Phones", "Home", "Food", "Services"];

export const products: Product[] = [
  {
    id: "shoe-1",
    title: "Nike Air sneakers",
    category: "Fashion",
    price: 85000,
    currency: "TZS",
    location: "Dar es Salaam, Tanzania",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=900",
    condition: "New",
    seller: { id: "seller-1", name: "Amani Store", verified: true, church: "TLMC" },
  },
  {
    id: "phone-1",
    title: "iPhone 14 Pro",
    category: "Phones",
    price: 720,
    currency: "USD",
    location: "Dallas, Texas",
    image: "https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=900",
    condition: "Used",
    seller: { id: "seller-2", name: "Prince Tech", verified: true, church: "Verified seller" },
  },
  {
    id: "chair-1",
    title: "Modern lounge chair",
    category: "Home",
    price: 180000,
    currency: "BIF",
    location: "Bujumbura, Burundi",
    image: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=900",
    condition: "New",
    seller: { id: "seller-3", name: "Maison Kaze", verified: true, church: "Eglise Vivante" },
  },
  {
    id: "bag-1",
    title: "Leather travel bag",
    category: "Fashion",
    price: 65000,
    currency: "TZS",
    location: "Arusha, Tanzania",
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=900",
    condition: "New",
    seller: { id: "seller-4", name: "Neema Fashion", verified: false, church: "Pending verification" },
  },
];

export const formatPrice = (price: number, currency: Product["currency"]) =>
  `${currency} ${price.toLocaleString("en-US")}`;
