
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import productsRoutes from './routes/products.routes.js';
import salesRoutes from './routes/sales.routes.js';
import purchaseRoutes from './routes/purchase.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import { errorHandler } from './middlewares/error.js';
import suppliersRoutes from './routes/suppliers.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import devRoutes from './routes/dev.routes.js';


const app = express();
app.use(cors({
  origin: ['http://localhost:5173'], // daftar origin yg diizinkan
  credentials: true,                 // <— wajib kalau kirim cookie
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// (opsional tapi bagus) tangani preflight
app.options('*', cors({
  origin: ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req,res)=>res.json({status:true, message:'IjaPlastik API OK'}));

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/products', productsRoutes);
app.use('/sales', salesRoutes);
app.use('/purchase', purchaseRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/suppliers', suppliersRoutes);
app.use('/reports', reportsRoutes);
app.use('/dev', devRoutes);


app.use(errorHandler);

export default app;
