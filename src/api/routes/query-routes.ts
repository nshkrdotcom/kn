// src/api/routes/query-routes.ts
 import express from 'express';
 import { QueryController } from '../controllers/query-controller';
 import { authenticate } from '../middlewares/auth';
 import { validateRequest } from '../middlewares/validation';
 import { queryValidator } from '../validators/query-validator';
 import { container } from '../../config/container';
 
 const router = express.Router();
 const queryController = container.resolve<QueryController>('queryController');
 
 /**
  * @route   POST /api/query
  * @desc    Send a query to the LLM
  * @access  Private
  */
 router.post(
   '/',
   authenticate(),
   validateRequest(queryValidator.query),
   (req, res, next) => queryController.query(req, res, next)
 );
 
 /**
  * @route   POST /api/query/stream
  * @desc    Stream a response from the LLM
  * @access  Private
  */
 router.post(
   '/stream',
   authenticate(),
   validateRequest(queryValidator.query),
   (req, res, next) => queryController.streamQuery(req, res, next)
 );
 
 /**
  * @route   GET /api/query/models
  * @desc    Get available LLM providers and models
  * @access  Private
  */
 router.get(
   '/models',
   authenticate(),
   (req, res, next) => queryController.getAvailableModels(req, res, next)
 );
 
 export default router;



//  // src/api/routes/query-routes.ts
// import express from 'express';
// import { QueryController } from '../controllers/query-controller';
// import { authMiddleware } from '../middlewares/auth';

// const createQueryRoutes = (queryController: QueryController) => {
//   const router = express.Router();
  
//   // All query routes require authentication
//   router.use(authMiddleware());
  
//   // Process a query
//   router.post('/', queryController.processQuery.bind(queryController));
  
//   // Get available models
//   router.get('/models', queryController.getAvailableModels.bind(queryController));
  
//   return router;
// };

// export default createQueryRoutes;