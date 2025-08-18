
export const checkRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ status:false, message:'Unauthorized' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ status:false, message:'Forbidden' });
  next();
};
