// src/api/validators/user-validator.ts
 import Joi from 'joi';
 
 /**
  * Validation schemas for user-related requests
  */
 export const userValidator = {
   /**
    * Schema for user registration
    */
   register: Joi.object({
     email: Joi.string()
       .email()
       .required()
       .messages({
         'string.email': 'Please enter a valid email address',
         'any.required': 'Email is required'
       }),
     password: Joi.string()
       .min(8)
       .required()
       .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
       .messages({
         'string.min': 'Password must be at least 8 characters long',
         'any.required': 'Password is required',
         'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
       }),
     name: Joi.string()
       .required()
       .min(2)
       .max(100)
       .messages({
         'string.min': 'Name must be at least 2 characters long',
         'string.max': 'Name cannot exceed 100 characters',
         'any.required': 'Name is required'
       })
   }),
   
   /**
    * Schema for user login
    */
   login: Joi.object({
     email: Joi.string()
       .email()
       .required()
       .messages({
         'string.email': 'Please enter a valid email address',
         'any.required': 'Email is required'
       }),
     password: Joi.string()
       .required()
       .messages({
         'any.required': 'Password is required'
       })
   }),
   
   /**
    * Schema for updating user (by user)
    */
   updateUser: Joi.object({
     name: Joi.string()
       .min(2)
       .max(100)
       .messages({
         'string.min': 'Name must be at least 2 characters long',
         'string.max': 'Name cannot exceed 100 characters'
       }),
     email: Joi.string()
       .email()
       .messages({
         'string.email': 'Please enter a valid email address'
       }),
     password: Joi.string()
       .min(8)
       .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
       .messages({
         'string.min': 'Password must be at least 8 characters long',
         'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
       }),
     settings: Joi.object()
       .messages({
         'object.base': 'Settings must be an object'
       })
   }).min(1).messages({
     'object.min': 'At least one field is required for update'
   }),
   
   /**
    * Schema for updating user (by admin)
    */
   updateUserAdmin: Joi.object({
     name: Joi.string()
       .min(2)
       .max(100)
       .messages({
         'string.min': 'Name must be at least 2 characters long',
         'string.max': 'Name cannot exceed 100 characters'
       }),
     email: Joi.string()
       .email()
       .messages({
         'string.email': 'Please enter a valid email address'
       }),
     password: Joi.string()
       .min(8)
       .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
       .messages({
         'string.min': 'Password must be at least 8 characters long',
         'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
       }),
     role: Joi.string()
       .valid('user', 'admin', 'editor')
       .messages({
         'any.only': 'Role must be one of: user, admin, editor'
       }),
     settings: Joi.object()
       .messages({
         'object.base': 'Settings must be an object'
       })
   }).min(1).messages({
     'object.min': 'At least one field is required for update'
   })
 };





//  // src/api/validators/user-validator.ts
// import Joi from 'joi';
// import { commonValidators } from './common-validators';

// export const userValidators = {
//   // Login request validation
//   login: Joi.object({
//     email: commonValidators.email,
//     password: Joi.string().required()
//   }),
  
//   // Registration request validation
//   register: Joi.object({
//     email: commonValidators.email,
//     password: commonValidators.password,
//     name: Joi.string().min(2).max(100).required()
//   }),
  
//   // Update profile validation
//   updateProfile: Joi.object({
//     name: Joi.string().min(2).max(100),
//     email: Joi.string().email(),
//     settings: Joi.object().unknown(true)
//   }).min(1),
  
//   // Password change validation
//   changePassword: Joi.object({
//     oldPassword: Joi.string().required(),
//     newPassword: commonValidators.password
//   }),
  
//   // Password reset request validation
//   resetPassword: Joi.object({
//     email: commonValidators.email
//   })
// };