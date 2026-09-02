import AddressService from '../services/address.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success, created } from '../utils/ApiResponse.js';

/**
 * AddressController — saved delivery addresses (BigBasket-style "My Addresses").
 */
class AddressController {
  /** GET /users/me/addresses */
  list = asyncHandler(async (req, res) => {
    const addresses = await AddressService.list({ userId: req.auth.userId, tenantId: req.tenantId });
    res.status(200).json(success(addresses, { message: 'Addresses fetched' }));
  });

  /** POST /users/me/addresses */
  create = asyncHandler(async (req, res) => {
    const address = await AddressService.create({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      payload: req.body,
    });
    res.status(201).json(created(address, { message: 'Address saved' }));
  });

  /** GET /users/me/addresses/:id */
  getById = asyncHandler(async (req, res) => {
    const address = await AddressService.get({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      addressId: req.params.id,
    });
    res.status(200).json(success(address, { message: 'Address fetched' }));
  });

  /** PATCH /users/me/addresses/:id */
  update = asyncHandler(async (req, res) => {
    const address = await AddressService.update({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      addressId: req.params.id,
      patch: req.body,
    });
    res.status(200).json(success(address, { message: 'Address updated' }));
  });

  /** DELETE /users/me/addresses/:id */
  remove = asyncHandler(async (req, res) => {
    const result = await AddressService.remove({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      addressId: req.params.id,
    });
    res.status(200).json(success(result, { message: 'Address removed' }));
  });

  /** PATCH /users/me/addresses/:id/default */
  setDefault = asyncHandler(async (req, res) => {
    const result = await AddressService.setDefault({
      userId: req.auth.userId,
      tenantId: req.tenantId,
      addressId: req.params.id,
    });
    res.status(200).json(success(result, { message: 'Default address set' }));
  });
}

export default new AddressController();
