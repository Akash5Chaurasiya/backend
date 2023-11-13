import express, { Request, Response, NextFunction } from "express";
import {
  AddGroup,
  DeleteChildPartFromFinishedItem,
  addBomComplete,
  addFinished,
  addPartInBetweenBom,
  addPartInBom,
  addProcessInEachChildPart,
  deleteFinishedItem,
  getAllFinished,
  getBomItemWithQuantity,
  getFinished,
  updateFinished,
  updateGroup,
  getAllGroup,
  updateProcess,
} from "../controllers/bomControllers/finishedItemController";

const finishedItemRouter = express.Router();

// // for single use
// finishedItemRouter.route("/singleUse").patch(updateFinishedItemStatus)


// delete childPart from masterBom
finishedItemRouter.route("/deleteInMasterBom/:id").patch(DeleteChildPartFromFinishedItem);

// added by dakshay
finishedItemRouter.route("/addBom").post(addPartInBom);
finishedItemRouter.route("/finishedItem/:finishedItemId").get(async (req: Request, resp: Response, next: NextFunction) => {
    try {
      const id = req.params.finishedItemId;
      const orderQuantity = 1;
      const data = await getBomItemWithQuantity(req, resp, id, orderQuantity);
      resp.status(200).json(data);
    } 
    catch (error) {
      console.log(error);
    }
  });

// finishItem groups -----------------------------------------------------------
finishedItemRouter.route("/addGroup").post(AddGroup);
finishedItemRouter.route("/getAllGroup").post(getAllGroup)
finishedItemRouter.route("/updateGroup/:groupId").patch(updateGroup);



// finishedItemRouter.route("/masterBom/:finishedItemId").get(getBomData);

// API for adding a childPart In BETWEEN a master bom 
finishedItemRouter.route("/editMasterBom").post(addPartInBetweenBom);

// api for updating process in master bom 
finishedItemRouter.route("/updateProcess/:id").post(updateProcess);

// adding filters and searching
finishedItemRouter.route("/").get(getAllFinished);
finishedItemRouter.route("/add").post(addFinished);
finishedItemRouter.route("/:id").get(getFinished).patch(updateFinished).delete(deleteFinishedItem);

//
// finishedItemRouter.route("/statusUpdate").post(addBomComplete);

// Add process in in every childPart
// finishedItemRouter.route("/addProcessInChild").post(addProcessInEachChildPart);



export default finishedItemRouter;
