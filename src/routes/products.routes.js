
import { Router } from 'express';
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../cloudinary.js';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import { addProduct, listProducts, getProduct, updateProduct, deleteProduct } from '../controllers/products.controller.js';

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({ folder: 'ijaplastik/products' })
});
const upload = multer({ storage });

const r = Router();
r.get('/', verify, listProducts);
r.get('/:id', verify, getProduct);
r.post('/', verify, checkRole('admin'), upload.single('image'), addProduct);
r.put('/:id', verify, checkRole('admin'), upload.single('image'), updateProduct);
r.delete('/:id', verify, checkRole('admin'), deleteProduct);

export default r;
