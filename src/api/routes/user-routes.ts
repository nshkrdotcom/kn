// src/api/routes/user-routes.ts
 import express from 'express';
 import { UserController } from '../controllers/user-controller';
 import { authenticate } from '../middlewares/auth';
 import { validateRequest } from '../middlewares/validation';
 import { userValidator } from '../validators/user-validator';
 import { container } from '../../config/container';
 
 const router = express.Router();
 const userController = container.resolve<UserController>('userController');
 
 /**
  * @route   POST /api/users/register
  * @desc    Register a new user
  * @access  Public
  */
 router.post(
   '/register',
   validateRequest(userValidator.register),
   (req, res, next) => userController.register(req, res, next)
 );
 
 /**
  * @route   POST /api/users/login
  * @desc    Login a user
  * @access  Public
  */
 router.post(
   '/login',
   validateRequest(userValidator.login),
   (req, res, next) => userController.login(req, res, next)
 );
 
 /**
  * @route   GET /api/users/me
  * @desc    Get the current user
  * @access  Private
  */
 router.get(
   '/me',
   authenticate(),
   (req, res, next) => userController.getCurrentUser(req, res, next)
 );
 
 /**
  * @route   PUT /api/users/me
  * @desc    Update the current user
  * @access  Private
  */
 router.put(
   '/me',
   authenticate(),
   validateRequest(userValidator.updateUser),
   (req, res, next) => userController.updateCurrentUser(req, res, next)
 );
 
 /**
  * @route   GET /api/users/:id
  * @desc    Get a user by ID
  * @access  Private (Admin only)
  */
 router.get(
   '/:id',
   authenticate('admin'),
   (req, res, next) => userController.getUserById(req, res, next)
 );
 
 /**
  * @route   PUT /api/users/:id
  * @desc    Update a user
  * @access  Private (Admin only)
  */
 router.put(
   '/:id',
   authenticate('admin'),
   validateRequest(userValidator.updateUserAdmin),
   (req, res, next) => userController.updateUser(req, res, next)
 );
 
 /**
  * @route   DELETE /api/users/:id
  * @desc    Delete a user
  * @access  Private (Admin only)
  */
 router.delete(
   '/:id',
   authenticate('admin'),
   (req, res, next) => userController.deleteUser(req, res, next)
 );
 
 export default router;





//  // src/api/routes/user-routes.ts
// import express from 'express';
// import { UserController } from '../controllers/user-controller';
// import { authMiddleware } from '../middlewares/auth';

// const createUserRoutes = (userController: UserController) => {
//   const router = express.Router();
  
//   // Public routes
//   router.post('/register', userController.register.bind(userController));
//   router.post('/login', userController.login.bind(userController));
//   router.post('/refresh-token', userController.refreshToken.bind(userController));
//   router.post('/reset-password', userController.resetPassword.bind(userController));
  
//   // Protected routes
//   router.get('/profile', authMiddleware(), userController.getProfile.bind(userController));
//   router.put('/profile', authMiddleware(), userController.updateProfile.bind(userController));
//   router.post('/change-password', authMiddleware(), userController.changePassword.bind(userController));
//   router.post('/logout', authMiddleware(), userController.logout.bind(userController));
  
//   return router;
// };

// export default createUserRoutes;