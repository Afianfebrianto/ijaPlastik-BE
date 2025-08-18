
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ status:false, message: err.message || 'Server error' });
};
